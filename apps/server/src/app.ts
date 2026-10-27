import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { checkRecipient } from "@crowdline/core";
import { HttpError, buildQuoteRequest, verifyQuoteSignature } from "@crowdline/oneclick";
import { parseAuditRequest, runAudit, text } from "./audit.ts";
import type { DataSource } from "./data.ts";
import { CROWD_LOOKBACK_HOURS } from "./data.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** An error whose message is safe and useful to show the user as is. */
export class UserError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new UserError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw new UserError(400, "Request body is not valid JSON");
  }
}

/** Turn upstream failures into messages a person can act on. */
export function explain(err: unknown): { status: number; message: string } {
  if (err instanceof UserError) return { status: err.status, message: err.message };
  if (err instanceof HttpError) {
    const host = new URL(err.url).host;
    const explorer = host.startsWith("explorer.");
    if (err.status === 429) {
      return {
        status: 429,
        message: explorer
          ? "The NEAR Intents Explorer is rate-limiting this server (one request per 5 seconds). Try again in a few seconds."
          : "1Click is rate-limiting this server. Try again in a few seconds.",
      };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        status: 502,
        message: explorer
          ? "The Explorer rejected this server's key. Check EXPLORER_JWT."
          : "1Click rejected the request: confidential quotes need a valid ONECLICK_API_KEY on the server.",
      };
    }
    if (!explorer && err.url.includes("/v0/quote")) {
      let detail = "";
      try {
        detail = (JSON.parse(err.body) as { message?: string }).message ?? "";
      } catch {
        /* not JSON */
      }
      if (err.status >= 500 || /internal/i.test(detail)) {
        return {
          status: 502,
          message:
            "1Click could not quote this swap. Check that the payout address is a wallet on the destination chain (not a token contract) and that the amount is not tiny.",
        };
      }
      return {
        status: 400,
        message: `1Click refused the quote: ${detail || err.body.slice(0, 200)}`,
      };
    }
    return {
      status: 502,
      message: `${explorer ? "The NEAR Intents Explorer" : "1Click"} is not answering right now (${err.status}). Try again shortly.`,
    };
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return {
      status: 503,
      message: "Could not reach NEAR Intents from this server. Try again shortly.",
    };
  }
  return { status: 400, message: err instanceof Error ? err.message : String(err) };
}

export function createApp(data: DataSource, webDist?: string) {
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true, mode: data.mode, quotes: data.hasApiKey });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const tokens = await data.tokens();
      const zec = tokens.find((t) => t.blockchain === "zec" && t.symbol === "ZEC");
      send(res, 200, {
        mode: data.mode,
        tokensAreDemo: data.tokensAreDemo,
        quotes: data.hasApiKey && !data.tokensAreDemo,
        lookbackHours: CROWD_LOOKBACK_HOURS,
        zec,
        destinations: tokens
          .filter((t) => t.blockchain !== "zec")
          .map(({ assetId, symbol, blockchain, decimals, price }) => ({
            assetId,
            symbol,
            blockchain,
            decimals,
            price,
          })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      send(res, 200, await data.stats());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/audit") {
      const body = parseAuditRequest(await readJson(req));
      const zec = await data.zec();
      const flows = await data.flows(body.destinationAsset);
      const result = runAudit(body, { flows, zecAsset: zec.assetId, zecUsd: zec.price });
      send(res, 200, { mode: data.mode, flowsChecked: flows.length, ...result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/quote") {
      if (data.tokensAreDemo) {
        throw new UserError(503, "1Click is unreachable from this server; quotes need it.");
      }
      if (!data.hasApiKey) {
        throw new UserError(
          503,
          "This server has no 1Click API key, and confidential quotes need one.",
        );
      }
      const b = (await readJson(req)) as Record<string, unknown>;
      const tokens = await data.tokens();
      const zec = await data.zec();
      const destinationAsset = text(b.destinationAsset);
      const dest = tokens.find((t) => t.assetId === destinationAsset);
      if (!dest) throw new UserError(400, "Unknown destination asset");
      const recipient = text(b.recipient);
      const bad = checkRecipient(dest.blockchain, recipient);
      if (bad) throw new UserError(400, bad);
      const request = buildQuoteRequest({
        zecAsset: zec.assetId,
        destinationAsset,
        amountZec: text(b.amountZec),
        recipient,
        refundTo: text(b.refundTo),
        confidentiality: b.confidentiality === "advanced" ? "advanced" : "basic",
        dry: b.dry === true,
      });
      const quote = await data.oneclick.quote(request);
      if (!verifyQuoteSignature(quote)) {
        throw new UserError(
          502,
          "1Click's quote signature did not verify, so Crowdline will not show it.",
        );
      }
      send(res, 200, quote);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const depositAddress = url.searchParams.get("depositAddress");
      if (!depositAddress) throw new UserError(400, "depositAddress is required");
      send(res, 200, await data.oneclick.status(depositAddress));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      send(res, 404, { message: "Not found" });
      return;
    }

    if (req.method === "GET" && webDist && existsSync(webDist)) {
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      let file = join(webDist, rel);
      const isAsset = file.startsWith(webDist) && existsSync(file) && !statSync(file).isDirectory();
      if (!isAsset) file = join(webDist, "index.html");
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
        "Cache-Control": rel.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      createReadStream(file).pipe(res);
      return;
    }

    send(res, 404, { message: "Not found" });
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    route(req, res).catch((err: unknown) => {
      const { status, message } = explain(err);
      send(res, status, { message });
    });
  };
}
