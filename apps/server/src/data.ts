import type { BacktestReport, Flow, RouteCrowd, SwapStats, TimingReport } from "@crowdline/core";
import {
  DEMO_DESTINATIONS,
  DEMO_ZEC_ASSET,
  backtest,
  compareRoutes,
  crowdByHour,
  dedupeFlows,
  demoFlows,
  flowsFromExplorer,
  swapStats,
  topDestinations,
} from "@crowdline/core";
import type { ExplorerQuery, Token } from "@crowdline/oneclick";
import { Explorer, OneClick, findZec } from "@crowdline/oneclick";
import type { CacheEnv, SharedCache } from "./cache.ts";
import { cacheFromEnv, explorerGate } from "./cache.ts";
import type { Lightwalletd } from "./lightwalletd.ts";
import { lightwalletd } from "./lightwalletd.ts";

export type Mode = "live" | "demo";

const LOOKBACK_HOURS = 24;
/** History kept for the by-hour view: three days, so each hour has three samples. */
const HISTORY_HOURS = 72;
const SERIES_TTL_MS = 120_000;
const TOKENS_TTL_MS = 300_000;
const STATS_TTL_MS = 300_000;
const BACKTEST_TTL_MS = 600_000;
/** Destinations compared in the route view. Each costs one Explorer read. */
const ROUTES = 3;

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

interface Series {
  flows: Flow[];
  pages: number;
  truncated: boolean;
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

export interface BacktestResponse extends BacktestReport {
  mode: Mode;
  generatedAt: string;
  destinations: string[];
}

export interface DataSourceOptions {
  oneclick?: OneClick;
  explorer?: Explorer;
  cache?: SharedCache;
  lightwalletd?: Lightwalletd;
  now?: () => number;
}

export class DataSource {
  readonly mode: Mode;
  readonly oneclick: OneClick;
  readonly hasApiKey: boolean;
  readonly cache: SharedCache;
  private readonly explorer?: Explorer;
  private readonly now: () => number;
  private readonly memo = new Map<string, Cached<unknown>>();
  private lwd?: Lightwalletd;
  tokensAreDemo = false;

  constructor(
    env: CacheEnv & { ONECLICK_API_KEY?: string; EXPLORER_JWT?: string },
    opts: DataSourceOptions = {},
  ) {
    this.hasApiKey = Boolean(env.ONECLICK_API_KEY);
    this.now = opts.now ?? (() => Date.now());
    this.cache = opts.cache ?? cacheFromEnv(env, this.now);
    this.oneclick = opts.oneclick ?? new OneClick({ apiKey: env.ONECLICK_API_KEY || undefined });
    this.explorer =
      opts.explorer ??
      (env.EXPLORER_JWT
        ? new Explorer({
            jwt: env.EXPLORER_JWT,
            ...(this.cache.shared ? { gate: explorerGate(this.cache) } : {}),
          })
        : undefined);
    this.mode = this.explorer ? "live" : "demo";
    this.lwd = opts.lightwalletd;
  }

  get chain(): Lightwalletd {
    this.lwd ??= lightwalletd();
    return this.lwd;
  }

  /**
   * One in-flight promise per key in this instance, backed by the shared
   * cache across instances. `shared: false` keeps a value local (it carries
   * a side effect, like the demo-token flag).
   */
  private cached<T>(key: string, ttl: number, load: () => Promise<T>, shared = true): Promise<T> {
    const hit = this.memo.get(key) as Cached<T> | undefined;
    if (hit && this.now() - hit.at < ttl) return hit.value;
    const value = (async () => {
      if (shared) {
        const stored = await this.cache.get<T>(key).catch(() => undefined);
        if (stored !== undefined) return stored;
      }
      const fresh = await load();
      if (shared) await this.cache.set(key, fresh, ttl).catch(() => undefined);
      return fresh;
    })();
    this.memo.set(key, { at: this.now(), value });
    value.catch(() => this.memo.delete(key));
    return value;
  }

  tokens(): Promise<Token[]> {
    return this.cached(
      "tokens",
      TOKENS_TTL_MS,
      () =>
        this.oneclick.tokens().then(
          (t) => {
            this.tokensAreDemo = false;
            return t;
          },
          (err: unknown) => {
            if (this.mode === "live") throw err;
            this.tokensAreDemo = true;
            return DEMO_TOKENS;
          },
        ),
      false,
    );
  }

  async zec(): Promise<Token> {
    return findZec(await this.tokens());
  }

  private nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  private async demo(destinationAsset?: string): Promise<Flow[]> {
    const zec = await this.zec();
    return demoFlows({ now: this.nowSec(), hours: HISTORY_HOURS, zecUsd: zec.price }).map((f) => ({
      ...f,
      originAsset: f.originAsset === DEMO_ZEC_ASSET ? zec.assetId : f.originAsset,
      // Point the busiest demo destination at whatever the user picked.
      destinationAsset:
        destinationAsset && f.destinationAsset === DEMO_DESTINATIONS[0]
          ? destinationAsset
          : f.destinationAsset,
    }));
  }

  /** Finished swaps matching one Explorer filter over the last three days. */
  private series(filter: Pick<ExplorerQuery, "fromChainId" | "toTokenId">): Promise<Series> {
    const key = `series:${filter.fromChainId ?? ""}:${filter.toTokenId ?? ""}`;
    return this.cached(key, SERIES_TTL_MS, async () => {
      if (!this.explorer) {
        const zec = await this.zec();
        const all = await this.demo(filter.toTokenId);
        const flows = filter.fromChainId
          ? all.filter((f) => f.originAsset === zec.assetId)
          : all.filter((f) => f.destinationAsset === filter.toTokenId);
        return { flows, pages: 0, truncated: false };
      }
      const res = await this.explorer.transactionsSince(
        { statuses: "SUCCESS", ...filter },
        this.nowSec() - HISTORY_HOURS * 3600,
      );
      return { flows: flowsFromExplorer(res.rows), pages: res.pages, truncated: res.truncated };
    });
  }

  private zecSeries() {
    return this.series({ fromChainId: "zec" });
  }

  /** Swaps out of Zcash plus payouts of `destinationAsset` from any chain. */
  private async history(destinationAsset: string): Promise<Flow[]> {
    const [out, dest] = await Promise.all([
      this.zecSeries(),
      this.series({ toTokenId: destinationAsset }),
    ]);
    return dedupeFlows([...out.flows, ...dest.flows]);
  }

  /** Swaps an observer could confuse with one going to `destinationAsset`, last 24 hours. */
  async flows(destinationAsset: string): Promise<Flow[]> {
    const since = this.nowSec() - LOOKBACK_HOURS * 3600;
    return (await this.history(destinationAsset)).filter((f) => f.t > since);
  }

  /** Headline numbers for the landing page. */
  stats(): Promise<StatsResponse> {
    return this.cached("stats", STATS_TTL_MS, async () => {
      const zec = await this.zec();
      const s = await this.zecSeries();
      return {
        mode: this.mode,
        generatedAt: new Date(this.now()).toISOString(),
        pages: s.pages,
        truncated: s.truncated,
        zecUsd: zec.price,
        ...swapStats(dedupeFlows(s.flows), {
          zecAsset: zec.assetId,
          now: this.nowSec(),
          lookbackHours: LOOKBACK_HOURS,
        }),
      };
    });
  }

  /** How crowded each hour of the day was for this swap, over three days. */
  async timing(destinationAsset: string, usd: number): Promise<TimingReport> {
    const zec = await this.zec();
    return crowdByHour(await this.history(destinationAsset), {
      usd,
      zecAsset: zec.assetId,
      destinationAsset,
      now: this.nowSec(),
      days: HISTORY_HOURS / 24,
    });
  }

  /** The destinations people leave Zcash for, plus `also` if given. */
  async destinations(also?: string): Promise<string[]> {
    const zec = await this.zec();
    const since = this.nowSec() - LOOKBACK_HOURS * 3600;
    const recent = (await this.zecSeries()).flows.filter((f) => f.t > since);
    const top = topDestinations(recent, zec.assetId, ROUTES);
    return also && !top.includes(also) ? [...top, also] : top;
  }

  /** The same swap sized on each well-used route. */
  async routes(usd: number, also?: string): Promise<RouteCrowd[]> {
    const zec = await this.zec();
    const dests = await this.destinations(also);
    const routes = [];
    // One after another: each is an Explorer read in the same rate-limit queue.
    for (const destinationAsset of dests) {
      routes.push({ destinationAsset, flows: await this.flows(destinationAsset) });
    }
    return compareRoutes(routes, { usd, zecAsset: zec.assetId, now: this.nowSec() });
  }

  /** Replay the observer against the last day of finished swaps. */
  backtest(): Promise<BacktestResponse> {
    return this.cached("backtest", BACKTEST_TTL_MS, async () => {
      const zec = await this.zec();
      const dests = await this.destinations();
      const flows: Flow[] = [];
      for (const d of dests) flows.push(...(await this.flows(d)));
      const covered = dedupeFlows(flows).filter(
        (f) => f.originAsset !== zec.assetId || dests.includes(f.destinationAsset),
      );
      return {
        mode: this.mode,
        generatedAt: new Date(this.now()).toISOString(),
        destinations: dests,
        ...backtest(covered, { zecAsset: zec.assetId, now: this.nowSec() }),
      };
    });
  }
}

export const CROWD_LOOKBACK_HOURS = LOOKBACK_HOURS;
