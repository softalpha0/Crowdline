import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { refundFromMnemonic } from "@crowdline/core";
import { Explorer, OneClick } from "@crowdline/oneclick";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { DataSource } from "../src/data.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const TOKENS = read("./fixtures/tokens.json");
const QUOTE = read("../../../packages/oneclick/test/fixtures/quote-dry-public.json");
const USDC_SOL = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const REFUND = refundFromMnemonic(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
).address;
const NOW = Date.parse("2026-10-27T16:00:00Z");

type Handler = (url: string, init?: RequestInit) => Response;
function fetchFrom(handler: Handler) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

let close: (() => void) | undefined;
afterEach(() => close?.());

async function serve(data: DataSource) {
  const server = createServer(createApp(data));
  await new Promise<void>((r) => server.listen(0, r));
  close = () => server.close();
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, init?: RequestInit) =>
    fetch(base + path, init).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    }));
}

function oneclick(quote: Handler = () => json(QUOTE)) {
  return fetchFrom((url, init) => (url.includes("/v0/tokens") ? json(TOKENS) : quote(url, init)));
}

const quoteBody = (over: Record<string, unknown> = {}) => ({
  method: "POST",
  body: JSON.stringify({
    destinationAsset: USDC_SOL,
    amountZec: "0.05",
    recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    refundTo: REFUND,
    ...over,
  }),
});

describe("/api/stats", () => {
  it("labels demo numbers as demo and caches them", async () => {
    let now = NOW;
    const { f } = oneclick();
    const data = new DataSource({}, { oneclick: new OneClick({ fetch: f }), now: () => now });
    const get = await serve(data);
    const a = await get("/api/stats");
    expect(a.status).toBe(200);
    expect(a.body.mode).toBe("demo");
    expect(a.body.zecSwaps).toBeGreaterThan(0);
    now += 60_000;
    expect((await get("/api/stats")).body.generatedAt).toBe(a.body.generatedAt);
    now += 5 * 60_000;
    expect((await get("/api/stats")).body.generatedAt).not.toBe(a.body.generatedAt);
  });

  it("reports live Explorer numbers without inventing any", async () => {
    const t = NOW / 1000 - 600;
    const rows = [1, 1, 1, 2.5].map((amount, i) => ({
      originAsset: "nep141:zec.omft.near",
      destinationAsset: USDC_SOL,
      recipient: `r${i}`,
      refundTo: `t${i}`,
      status: "SUCCESS",
      createdAtTimestamp: t - i,
      amountInFormatted: String(amount),
      amountInUsd: String(amount * 1292.91),
      amountOutUsd: String(amount * 1290),
      depositAddress: `t1d${i}`,
    }));
    const ex = fetchFrom(() => json(rows));
    const { f } = oneclick();
    const data = new DataSource(
      { EXPLORER_JWT: "j" },
      {
        oneclick: new OneClick({ fetch: f }),
        explorer: new Explorer({ jwt: "j", fetch: ex.f, minGapMs: 0 }),
        now: () => NOW,
      },
    );
    const { body } = await (await serve(data))("/api/stats");
    expect(body).toMatchObject({ mode: "live", zecSwaps: 4, pages: 1, truncated: false });
    expect(body.commonAmounts).toEqual([
      expect.objectContaining({ amountZec: 1, count: 3, destinationAsset: USDC_SOL }),
    ]);
    expect(ex.calls[0]).toContain("fromChainId=zec");
  });
});

describe("/api/quote", () => {
  it("refuses without an API key, before calling 1Click", async () => {
    const { f, calls } = oneclick();
    const get = await serve(new DataSource({}, { oneclick: new OneClick({ fetch: f }) }));
    const r = await get("/api/quote", quoteBody());
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/API key/);
    expect(calls.some((c) => c.includes("/v0/quote"))).toBe(false);
  });

  it("passes a quote whose signature verifies", async () => {
    const { f, calls } = oneclick();
    const data = new DataSource(
      { ONECLICK_API_KEY: "k" },
      { oneclick: new OneClick({ apiKey: "k", fetch: f }) },
    );
    const r = await (await serve(data))("/api/quote", quoteBody());
    expect(r.status).toBe(200);
    expect(r.body.signature).toMatch(/^ed25519:/);
    expect(calls.filter((c) => c.includes("/v0/quote"))).toHaveLength(1);
  });

  it("blocks a quote that was changed after signing", async () => {
    const tampered = JSON.parse(QUOTE) as { quote: { amountOut: string } };
    tampered.quote.amountOut = "1";
    const { f } = oneclick(() => json(tampered));
    const data = new DataSource(
      { ONECLICK_API_KEY: "k" },
      { oneclick: new OneClick({ apiKey: "k", fetch: f }) },
    );
    const r = await (await serve(data))("/api/quote", quoteBody());
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/signature/);
  });

  it("catches a wrong-chain payout address before 1Click does", async () => {
    const { f, calls } = oneclick();
    const data = new DataSource(
      { ONECLICK_API_KEY: "k" },
      { oneclick: new OneClick({ apiKey: "k", fetch: f }) },
    );
    const r = await (
      await serve(data)
    )("/api/quote", quoteBody({ recipient: "0x000000000000000000000000000000000000dEaD" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/sol address/);
    expect(calls.some((c) => c.includes("/v0/quote"))).toBe(false);
  });

  it("explains 1Click's bare 500 in plain words", async () => {
    const { f } = oneclick(() => json({ message: "Internal server error", statusCode: 400 }, 400));
    const data = new DataSource(
      { ONECLICK_API_KEY: "k" },
      { oneclick: new OneClick({ apiKey: "k", fetch: f }) },
    );
    const r = await (await serve(data))("/api/quote", quoteBody());
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/payout address is a wallet/);
  });
});

describe("routing and errors", () => {
  it("explains an Explorer rate limit", async () => {
    const ex = fetchFrom(() => json({ message: "Too Many Requests" }, 429));
    const { f } = oneclick();
    const data = new DataSource(
      { EXPLORER_JWT: "j" },
      {
        oneclick: new OneClick({ fetch: f }),
        explorer: new Explorer({ jwt: "j", fetch: ex.f, minGapMs: 0 }),
      },
    );
    const r = await (await serve(data))("/api/stats");
    expect(r.status).toBe(429);
    expect(r.body.message).toMatch(/rate-limiting/);
  });

  it("answers health and 404s unknown API paths", async () => {
    const { f } = oneclick();
    const get = await serve(new DataSource({}, { oneclick: new OneClick({ fetch: f }) }));
    expect((await get("/api/health")).body).toEqual({ ok: true, mode: "demo", quotes: false });
    expect((await get("/api/nope")).status).toBe(404);
  });
});

describe("Vercel entry", () => {
  it("restores the original /api path from the rewrite", async () => {
    const { restoreUrl } = await import("../src/vercel.ts");
    expect(restoreUrl("/api?__path=stats")).toBe("/api/stats");
    expect(restoreUrl("/api?depositAddress=t1x&__path=status")).toBe(
      "/api/status?depositAddress=t1x",
    );
    expect(restoreUrl("/api/config")).toBe("/api/config");
  });
});
