import { sizeCrowd } from "./crowd.ts";
import type { Flow } from "./types.ts";

export interface CommonAmount {
  amountZec: number;
  /** Swaps of exactly this amount in the window. */
  count: number;
  /** Where most of them went. */
  destinationAsset: string;
  /** Expected look-alike swaps for one more swap of this amount, yourself included. */
  crowd: number;
}

export interface SwapStats {
  lookbackHours: number;
  /** Finished swaps out of Zcash in the window. */
  zecSwaps: number;
  /** Their total USD value going in. */
  zecVolumeUsd: number;
  /** Median USD size of those swaps. */
  medianSwapUsd: number;
  /** Most repeated exact ZEC amounts, most common first. */
  commonAmounts: CommonAmount[];
  /** Median of `crowd` across `commonAmounts`; 1 when there are none. */
  medianCommonCrowd: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? 0;
  return s.length % 2 ? hi : ((s[mid - 1] ?? hi) + hi) / 2;
}

function mostCommon(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * Headline numbers for the last `lookbackHours` of swaps out of Zcash.
 *
 * When `flows` holds only Zcash-origin swaps (as /api/stats fetches them),
 * payouts that started on other chains are not counted, so `crowd` is a
 * lower bound: real crowds can only be the same or bigger.
 */
export function swapStats(
  flows: Flow[],
  opts: { zecAsset: string; now: number; lookbackHours?: number; limit?: number },
): SwapStats {
  const lookbackHours = opts.lookbackHours ?? 24;
  const since = opts.now - lookbackHours * 3600;
  const zec = flows.filter(
    (f) => f.originAsset === opts.zecAsset && f.t > since && f.t <= opts.now,
  );

  const byAmount = new Map<string, Flow[]>();
  for (const f of zec) {
    const key = f.amountIn.toFixed(4);
    byAmount.set(key, [...(byAmount.get(key) ?? []), f]);
  }

  const commonAmounts = [...byAmount.entries()]
    .filter(([, fs]) => fs.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || Number(b[0]) - Number(a[0]))
    .slice(0, opts.limit ?? 6)
    .map(([amount, fs]): CommonAmount => {
      const destinationAsset = mostCommon(fs.map((f) => f.destinationAsset));
      const usd = median(fs.map((f) => f.amountInUsd));
      const crowd = sizeCrowd(
        flows,
        { usd, zecAsset: opts.zecAsset, destinationAsset, now: opts.now },
        { lookbackHours },
      ).k;
      return { amountZec: Number(amount), count: fs.length, destinationAsset, crowd };
    });

  return {
    lookbackHours,
    zecSwaps: zec.length,
    zecVolumeUsd: zec.reduce((n, f) => n + f.amountInUsd, 0),
    medianSwapUsd: median(zec.map((f) => f.amountInUsd)),
    commonAmounts,
    medianCommonCrowd: commonAmounts.length ? median(commonAmounts.map((c) => c.crowd)) : 1,
  };
}
