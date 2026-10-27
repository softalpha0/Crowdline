import type { Flow, SwapStats } from "@crowdline/core";
import {
  DEMO_DESTINATIONS,
  DEMO_ZEC_ASSET,
  dedupeFlows,
  demoFlows,
  flowsFromExplorer,
  swapStats,
} from "@crowdline/core";
import type { Token } from "@crowdline/oneclick";
import { Explorer, OneClick, findZec } from "@crowdline/oneclick";

export type Mode = "live" | "demo";

const LOOKBACK_HOURS = 24;
const FLOWS_TTL_MS = 120_000;
const TOKENS_TTL_MS = 300_000;
const STATS_TTL_MS = 300_000;

/** Fallback token list used only in demo mode when 1Click cannot be reached. */
const DEMO_TOKENS: Token[] = [
  { assetId: DEMO_ZEC_ASSET, decimals: 8, blockchain: "zec", symbol: "ZEC", price: 300 },
  { assetId: DEMO_DESTINATIONS[0], decimals: 6, blockchain: "sol", symbol: "USDC", price: 1 },
  { assetId: DEMO_DESTINATIONS[1], decimals: 6, blockchain: "eth", symbol: "USDC", price: 1 },
  { assetId: DEMO_DESTINATIONS[2], decimals: 6, blockchain: "tron", symbol: "USDT", price: 1 },
  { assetId: DEMO_DESTINATIONS[3], decimals: 8, blockchain: "btc", symbol: "BTC", price: 100000 },
];

interface Cached<T> {
  at: number;
  value: Promise<T>;
}

export interface StatsResponse extends SwapStats {
  mode: Mode;
  generatedAt: string;
  /** Explorer pages read, and whether the page limit cut the window short. */
  pages: number;
  truncated: boolean;
  /** ZEC price the numbers were computed with. */
  zecUsd: number;
}

export interface DataSourceOptions {
  oneclick?: OneClick;
  explorer?: Explorer;
  now?: () => number;
}

export class DataSource {
  readonly mode: Mode;
  readonly oneclick: OneClick;
  readonly hasApiKey: boolean;
  private readonly explorer?: Explorer;
  private readonly now: () => number;
  private tokensCache?: Cached<Token[]>;
  private statsCache?: Cached<StatsResponse>;
  private readonly flowCache = new Map<string, Cached<Flow[]>>();
  tokensAreDemo = false;

  constructor(
    env: { ONECLICK_API_KEY?: string; EXPLORER_JWT?: string },
    opts: DataSourceOptions = {},
  ) {
    this.hasApiKey = Boolean(env.ONECLICK_API_KEY);
    this.oneclick = opts.oneclick ?? new OneClick({ apiKey: env.ONECLICK_API_KEY || undefined });
    this.explorer =
      opts.explorer ?? (env.EXPLORER_JWT ? new Explorer({ jwt: env.EXPLORER_JWT }) : undefined);
    this.mode = this.explorer ? "live" : "demo";
    this.now = opts.now ?? (() => Date.now());
  }

  private cached<T>(slot: Cached<T> | undefined, ttl: number): Promise<T> | undefined {
    return slot && this.now() - slot.at < ttl ? slot.value : undefined;
  }

  tokens(): Promise<Token[]> {
    const hit = this.cached(this.tokensCache, TOKENS_TTL_MS);
    if (hit) return hit;
    const value = this.oneclick.tokens().then(
      (t) => {
        this.tokensAreDemo = false;
        return t;
      },
      (err: unknown) => {
        if (this.mode === "live") throw err;
        this.tokensAreDemo = true;
        return DEMO_TOKENS;
      },
    );
    this.tokensCache = { at: this.now(), value };
    value.catch(() => (this.tokensCache = undefined));
    return value;
  }

  async zec(): Promise<Token> {
    return findZec(await this.tokens());
  }

  private async demo(destinationAsset?: string): Promise<Flow[]> {
    const zec = await this.zec();
    const now = Math.floor(this.now() / 1000);
    return demoFlows({ now, hours: LOOKBACK_HOURS, zecUsd: zec.price }).map((f) => ({
      ...f,
      originAsset: f.originAsset === DEMO_ZEC_ASSET ? zec.assetId : f.originAsset,
      // Point the busiest demo destination at whatever the user picked.
      destinationAsset:
        destinationAsset && f.destinationAsset === DEMO_DESTINATIONS[0]
          ? destinationAsset
          : f.destinationAsset,
    }));
  }

  /** Swaps an observer could confuse with one going to `destinationAsset`. */
  flows(destinationAsset: string): Promise<Flow[]> {
    const hit = this.cached(this.flowCache.get(destinationAsset), FLOWS_TTL_MS);
    if (hit) return hit;

    const value = (async () => {
      if (!this.explorer) return this.demo(destinationAsset);
      const now = Math.floor(this.now() / 1000);
      const rows = await this.explorer.crowdRows(destinationAsset, LOOKBACK_HOURS, now);
      return dedupeFlows(flowsFromExplorer(rows));
    })();

    this.flowCache.set(destinationAsset, { at: this.now(), value });
    value.catch(() => this.flowCache.delete(destinationAsset));
    return value;
  }

  /** Headline numbers for the landing page. Cached for five minutes. */
  stats(): Promise<StatsResponse> {
    const hit = this.cached(this.statsCache, STATS_TTL_MS);
    if (hit) return hit;

    const value = (async (): Promise<StatsResponse> => {
      const zec = await this.zec();
      const now = Math.floor(this.now() / 1000);
      let flows: Flow[];
      let pages = 0;
      let truncated = false;
      if (this.explorer) {
        const res = await this.explorer.transactionsSince(
          { fromChainId: "zec", statuses: "SUCCESS" },
          now - LOOKBACK_HOURS * 3600,
        );
        flows = dedupeFlows(flowsFromExplorer(res.rows));
        ({ pages, truncated } = res);
      } else {
        flows = (await this.demo()).filter((f) => f.originAsset === zec.assetId);
      }
      return {
        mode: this.mode,
        generatedAt: new Date(this.now()).toISOString(),
        pages,
        truncated,
        zecUsd: zec.price,
        ...swapStats(flows, { zecAsset: zec.assetId, now, lookbackHours: LOOKBACK_HOURS }),
      };
    })();

    this.statsCache = { at: this.now(), value };
    value.catch(() => (this.statsCache = undefined));
    return value;
  }
}

export const CROWD_LOOKBACK_HOURS = LOOKBACK_HOURS;
