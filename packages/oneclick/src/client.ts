import type { ExplorerRow } from "@crowdline/core";
import type { QuoteRequest, QuoteResponse, StatusResponse, Token } from "./types.ts";

export const ONECLICK_URL = "https://1click.chaindefuser.com";
export const EXPLORER_URL = "https://explorer.near-intents.org/api/v0";

type Fetch = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`${status} from ${new URL(url).host}: ${body.slice(0, 300)}`);
  }
}

async function json<T>(f: Fetch, url: string, init: RequestInit = {}): Promise<T> {
  const res = await f(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return JSON.parse(text) as T;
}

/** Client for the 1Click Swap API. */
export class OneClick {
  constructor(private readonly opts: { apiKey?: string; baseUrl?: string; fetch?: Fetch } = {}) {}

  private get f(): Fetch {
    return this.opts.fetch ?? fetch;
  }

  private url(path: string): string {
    return `${this.opts.baseUrl ?? ONECLICK_URL}${path}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.opts.apiKey) h["X-API-Key"] = this.opts.apiKey;
    return h;
  }

  tokens(): Promise<Token[]> {
    return json(this.f, this.url("/v0/tokens"), { headers: this.headers() });
  }

  quote(req: QuoteRequest): Promise<QuoteResponse> {
    return json(this.f, this.url("/v0/quote"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(req),
    });
  }

  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return json(this.f, this.url(`/v0/status?${q}`), { headers: this.headers() });
  }

  /** Optional: tell 1Click the deposit is on its way so it starts sooner. */
  submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
    return json(this.f, this.url("/v0/deposit/submit"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ txHash, depositAddress }),
    });
  }
}

/** The native ZEC token on the Zcash chain, looked up rather than hard-coded. */
export function findZec(tokens: Token[]): Token {
  const zec = tokens.find((t) => t.blockchain === "zec" && t.symbol.toUpperCase() === "ZEC");
  if (!zec) throw new Error("1Click does not list ZEC on the zec chain right now");
  return zec;
}

export interface ExplorerQuery {
  fromChainId?: string;
  toTokenId?: string;
  startTimestampUnix?: number;
  endTimestampUnix?: number;
  statuses?: string;
  numberOfTransactions?: number;
  search?: string;
  lastDepositAddress?: string;
  lastDepositMemo?: string;
  direction?: "next" | "prev";
}

/** The Explorer's largest page. */
export const EXPLORER_PAGE = 1000;

export interface Pages {
  rows: ExplorerRow[];
  pages: number;
  /** True when maxPages ran out before reaching `since`: the crowd is undercounted. */
  truncated: boolean;
}

/**
 * Client for the NEAR Intents Explorer API. It allows one request every
 * five seconds per partner, so calls are queued and spaced here.
 */
export class Explorer {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly opts: {
      jwt: string;
      baseUrl?: string;
      fetch?: Fetch;
      minGapMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const gap = this.opts.minGapMs ?? 5_100;
    const sleep = this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const run = this.chain.then(async () => {
      const wait = this.last + gap - Date.now();
      if (this.last && wait > 0) await sleep(wait);
      this.last = Date.now();
      return task();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  transactions(q: ExplorerQuery): Promise<ExplorerRow[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    const url = `${this.opts.baseUrl ?? EXPLORER_URL}/transactions?${params}`;
    return this.schedule(() =>
      json<ExplorerRow[]>(this.opts.fetch ?? fetch, url, {
        headers: { Authorization: `Bearer ${this.opts.jwt}` },
      }),
    );
  }

  /**
   * Every transaction matching `q` created after `since`, newest first.
   * Walks older pages with the lastDepositAddress cursor; each page waits
   * its turn in the rate-limit queue, so maxPages bounds the time spent.
   */
  async transactionsSince(
    q: Omit<ExplorerQuery, "lastDepositAddress" | "lastDepositMemo" | "direction">,
    since: number,
    maxPages = 6,
  ): Promise<Pages> {
    const rows: ExplorerRow[] = [];
    let cursor: Pick<ExplorerQuery, "lastDepositAddress" | "lastDepositMemo"> = {};
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.transactions({
        ...q,
        startTimestampUnix: since,
        numberOfTransactions: EXPLORER_PAGE,
        ...cursor,
        ...(page > 1 ? { direction: "next" as const } : {}),
      });
      rows.push(...batch.filter((r) => r.createdAtTimestamp > since));
      const last = batch[batch.length - 1];
      if (
        batch.length < EXPLORER_PAGE ||
        !last?.depositAddress ||
        last.createdAtTimestamp <= since
      ) {
        return { rows, pages: page, truncated: false };
      }
      cursor = {
        lastDepositAddress: last.depositAddress,
        ...(last.depositMemo ? { lastDepositMemo: last.depositMemo } : {}),
      };
    }
    return { rows, pages: maxPages, truncated: true };
  }

  /**
   * Everything the crowd model needs for one destination: recent swaps out of
   * Zcash, plus recent payouts of the destination asset from any chain.
   */
  async crowdRows(
    destinationAsset: string,
    lookbackHours: number,
    now: number,
  ): Promise<ExplorerRow[]> {
    const since = now - lookbackHours * 3600;
    const base = { statuses: "SUCCESS" };
    const [fromZec, toDest] = await Promise.all([
      this.transactionsSince({ ...base, fromChainId: "zec" }, since),
      this.transactionsSince({ ...base, toTokenId: destinationAsset }, since),
    ]);
    return [...fromZec.rows, ...toDest.rows];
  }
}
