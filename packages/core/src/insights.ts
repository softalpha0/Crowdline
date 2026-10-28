import { sizeCrowd } from "./crowd.ts";
import type { Crowd, CrowdOptions, Flow } from "./types.ts";
import { DEFAULT_CROWD } from "./types.ts";

const within = (v: number, target: number, band: number) => Math.abs(v - target) <= target * band;

/** First index whose value is >= x, in an ascending array. */
function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is > x, in an ascending array. */
function upperBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] ?? 0) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ───────────────────────── 1. when to swap ─────────────────────────

export interface HourCrowd {
  /** Hour of day, 0–23, in UTC. */
  hour: number;
  inPerHour: number;
  outPerHour: number;
  /** Expected look-alike swaps, yourself included, for a swap made in this hour. */
  k: number;
}

export interface TimingReport {
  days: number;
  hours: HourCrowd[];
  /** Hours ranked by crowd, biggest first (ties keep the earlier hour). */
  best: number[];
}

/**
 * Crowd size by hour of day, averaged over the last `days` days. The same
 * model as sizeCrowd, but counting only swaps in each UTC hour, so the user
 * can see when swaps like theirs are common.
 */
export function crowdByHour(
  flows: Flow[],
  q: { usd: number; zecAsset: string; destinationAsset: string; now: number; days: number },
  opts: Partial<CrowdOptions> = {},
): TimingReport {
  const o = { ...DEFAULT_CROWD, ...opts };
  if (!(q.usd > 0)) throw new Error("Swap value must be positive");
  const since = q.now - q.days * 86400;
  const ins = new Array<number>(24).fill(0);
  const outs = new Array<number>(24).fill(0);
  for (const f of flows) {
    if (f.t <= since || f.t > q.now) continue;
    const hr = new Date(f.t * 1000).getUTCHours();
    if (f.originAsset === q.zecAsset && within(f.amountInUsd, q.usd, o.band))
      ins[hr] = (ins[hr] ?? 0) + 1;
    if (f.destinationAsset === q.destinationAsset && within(f.amountOutUsd, q.usd, o.band))
      outs[hr] = (outs[hr] ?? 0) + 1;
  }
  const hours = ins.map((n, hour) => {
    const inPerHour = n / q.days;
    const outPerHour = (outs[hour] ?? 0) / q.days;
    return {
      hour,
      inPerHour,
      outPerHour,
      k: 1 + Math.min(inPerHour, outPerHour) * 2 * o.windowHours,
    };
  });
  const best = [...hours].sort((a, b) => b.k - a.k || a.hour - b.hour).map((h) => h.hour);
  return { days: q.days, hours, best };
}

// ───────────────────────── 2. which route ─────────────────────────

export interface RouteCrowd {
  destinationAsset: string;
  crowd: Crowd;
  /** Swaps out of Zcash to this asset in the window: how well trodden the route is. */
  zecSwaps: number;
}

/** Size the same swap on several destination routes, biggest crowd first. */
export function compareRoutes(
  routes: { destinationAsset: string; flows: Flow[] }[],
  q: { usd: number; zecAsset: string; now: number },
  opts: Partial<CrowdOptions> = {},
): RouteCrowd[] {
  const lookback = { ...DEFAULT_CROWD, ...opts }.lookbackHours;
  return routes
    .map(({ destinationAsset, flows }) => ({
      destinationAsset,
      crowd: sizeCrowd(
        flows,
        { usd: q.usd, zecAsset: q.zecAsset, destinationAsset, now: q.now },
        opts,
      ),
      zecSwaps: flows.filter(
        (f) =>
          f.originAsset === q.zecAsset &&
          f.destinationAsset === destinationAsset &&
          f.t > q.now - lookback * 3600 &&
          f.t <= q.now,
      ).length,
    }))
    .sort((a, b) => b.crowd.k - a.crowd.k || b.zecSwaps - a.zecSwaps);
}

/** The destinations people actually leave Zcash for, most used first. */
export function topDestinations(flows: Flow[], zecAsset: string, limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const f of flows) {
    if (f.originAsset === zecAsset)
      counts.set(f.destinationAsset, (counts.get(f.destinationAsset) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([d]) => d);
}

// ───────────────────────── 8. does the score hold up ─────────────────────────

export interface BacktestBucket {
  /** Predicted crowd range, inclusive lower bound. */
  fromK: number;
  toK: number;
  swaps: number;
  /** Mean number of payouts an observer could not tell apart, the true one included. */
  meanCandidates: number;
  /** Share of swaps where the true payout was the only candidate. */
  uniquelyLinked: number;
}

export interface BacktestReport {
  /** Zcash-origin swaps tested. */
  swaps: number;
  /** Share whose true payout fell inside the observer's ±band at all. */
  trueInBand: number;
  /** Share an observer would link with certainty: one candidate, and it is the right one. */
  uniquelyLinked: number;
  medianCandidates: number;
  buckets: BacktestBucket[];
  windowHours: number;
  band: number;
}

/**
 * Replay the observer the score models against finished swaps, where the
 * Explorer tells us which payout really belonged to which deposit.
 *
 * For each swap out of Zcash, an observer sees a deposit worth $X at time t
 * and looks for payouts of the same asset worth within ±band of $X inside
 * ±window. We count those candidates and check whether the true payout is
 * among them. The Explorer records one creation time per swap, so deposit and
 * payout are both placed at that time: the real gap of a few minutes is well
 * inside the ±15 minute window.
 */
export function backtest(
  flows: Flow[],
  q: { zecAsset: string; now: number },
  opts: Partial<CrowdOptions> = {},
): BacktestReport {
  const o = { ...DEFAULT_CROWD, ...opts };
  const since = q.now - o.lookbackHours * 3600;
  const recent = flows.filter((f) => f.t > since && f.t <= q.now);
  const window = o.windowHours * 3600;

  // Sorted values make each count a pair of binary searches, so a day of
  // thousands of swaps replays in milliseconds. Same counts as sizeCrowd.
  const zecIn = recent
    .filter((f) => f.originAsset === q.zecAsset)
    .map((f) => f.amountInUsd)
    .sort((a, b) => a - b);
  const byDest = new Map<string, Flow[]>();
  for (const f of recent)
    byDest.set(f.destinationAsset, [...(byDest.get(f.destinationAsset) ?? []), f]);
  const outUsd = new Map<string, number[]>();
  const times = new Map<string, number[]>();
  for (const [d, fs] of byDest) {
    fs.sort((a, b) => a.t - b.t);
    times.set(
      d,
      fs.map((f) => f.t),
    );
    outUsd.set(
      d,
      fs.map((f) => f.amountOutUsd).sort((a, b) => a - b),
    );
  }
  const inBandCount = (sorted: number[], usd: number) =>
    upperBound(sorted, usd * (1 + o.band)) - lowerBound(sorted, usd * (1 - o.band));

  const rows: { k: number; candidates: number; inBand: boolean }[] = [];
  for (const f of recent) {
    if (f.originAsset !== q.zecAsset) continue;
    const pool = byDest.get(f.destinationAsset) ?? [];
    let candidates = 0;
    for (
      let i = lowerBound(times.get(f.destinationAsset) ?? [], f.t - window);
      i < pool.length;
      i++
    ) {
      const p = pool[i];
      if (!p || p.t > f.t + window) break;
      if (within(p.amountOutUsd, f.amountInUsd, o.band)) candidates++;
    }
    const inPerHour = inBandCount(zecIn, f.amountInUsd) / o.lookbackHours;
    const outPerHour =
      inBandCount(outUsd.get(f.destinationAsset) ?? [], f.amountInUsd) / o.lookbackHours;
    const k = 1 + Math.min(inPerHour, outPerHour) * 2 * o.windowHours;
    rows.push({ k, candidates, inBand: within(f.amountOutUsd, f.amountInUsd, o.band) });
  }

  const edges: [number, number][] = [
    [1, 1.5],
    [1.5, 2],
    [2, 4],
    [4, Infinity],
  ];
  const buckets = edges.map(([fromK, toK]) => {
    const rs = rows.filter((r) => r.k >= fromK && r.k < toK);
    return {
      fromK,
      toK,
      swaps: rs.length,
      meanCandidates: rs.length ? rs.reduce((n, r) => n + r.candidates, 0) / rs.length : 0,
      uniquelyLinked: rs.length
        ? rs.filter((r) => r.inBand && r.candidates === 1).length / rs.length
        : 0,
    };
  });
  const sorted = rows.map((r) => r.candidates).sort((a, b) => a - b);
  const share = (pred: (r: (typeof rows)[number]) => boolean) =>
    rows.length ? rows.filter(pred).length / rows.length : 0;
  return {
    swaps: rows.length,
    trueInBand: share((r) => r.inBand),
    uniquelyLinked: share((r) => r.inBand && r.candidates === 1),
    medianCandidates: sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0,
    buckets,
    windowHours: o.windowHours,
    band: o.band,
  };
}
