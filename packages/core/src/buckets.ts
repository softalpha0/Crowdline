import { sizeCrowd } from "./crowd.ts";
import type { Crowd, CrowdOptions, Flow } from "./types.ts";
import { formatZec, parseZec, zatsToNumber } from "./units.ts";

export interface BucketOptions {
  /** Largest share of the amount the user is willing to keep back. 0.3 = up to 30%. */
  maxHoldBack: number;
  /** Smallest swap worth suggesting, in ZEC. */
  minZec: number;
  /** How many candidates to return. */
  limit: number;
}

export const DEFAULT_BUCKETS: BucketOptions = {
  maxHoldBack: 0.3,
  minZec: 0.05,
  limit: 5,
};

export interface Bucket {
  /** ZEC to send through the swap, as a canonical decimal string. */
  amountZec: string;
  /** ZEC kept back in the shielded wallet. */
  holdBackZec: string;
  crowd: Crowd;
  /** Why this amount is on the list. */
  reason: "as-entered" | "round-number" | "crowd-mode";
}

export interface BucketQuery {
  amountZec: string | number;
  zecUsd: number;
  zecAsset: string;
  destinationAsset: string;
  now?: number;
}

const STEPS = [1, 2, 2.5, 5];

/** Round-number amounts at or below `amount` with one or two significant figures. */
function roundCandidates(amount: number, floor: number): number[] {
  const out = new Set<number>();
  const top = Math.floor(Math.log10(amount));
  for (let e = top; e >= top - 2; e--) {
    for (const s of STEPS) {
      const step = s * 10 ** e;
      const v = Math.floor(amount / step) * step;
      if (v >= floor && v <= amount) out.add(Number(v.toFixed(8)));
    }
  }
  return [...out];
}

/** The exact ZEC amounts other people actually swapped, most common first. */
function crowdModes(flows: Flow[], zecAsset: string, lo: number, hi: number): number[] {
  const counts = new Map<string, number>();
  for (const f of flows) {
    if (f.originAsset !== zecAsset || !(f.amountIn >= lo && f.amountIn <= hi)) continue;
    const key = f.amountIn.toFixed(4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([v]) => Number(v));
}

/**
 * Suggest swap amounts that hide in a bigger crowd than the amount the user
 * typed. Never suggests more than the user asked to send: the difference
 * stays in their shielded wallet, it is not spent.
 */
export function suggestBuckets(
  flows: Flow[],
  q: BucketQuery,
  opts: Partial<BucketOptions> = {},
  crowdOpts: Partial<CrowdOptions> = {},
): Bucket[] {
  const o = { ...DEFAULT_BUCKETS, ...opts };
  const requestedZats = parseZec(q.amountZec);
  const requested = zatsToNumber(requestedZats);
  const floor = Math.max(o.minZec, requested * (1 - o.maxHoldBack));

  const size = (zec: number) =>
    sizeCrowd(
      flows,
      {
        usd: zec * q.zecUsd,
        zecAsset: q.zecAsset,
        destinationAsset: q.destinationAsset,
        now: q.now,
      },
      crowdOpts,
    );

  const candidates = new Map<string, Bucket["reason"]>();
  candidates.set(formatZec(requestedZats), "as-entered");
  for (const v of crowdModes(flows, q.zecAsset, floor, requested)) {
    const key = formatZec(parseZec(v));
    if (!candidates.has(key)) candidates.set(key, "crowd-mode");
  }
  for (const v of roundCandidates(requested, floor)) {
    const key = formatZec(parseZec(v));
    if (!candidates.has(key)) candidates.set(key, "round-number");
  }

  const buckets: Bucket[] = [...candidates.entries()].map(([amountZec, reason]) => {
    const zats = parseZec(amountZec);
    return {
      amountZec,
      holdBackZec: formatZec(requestedZats - zats),
      crowd: size(zatsToNumber(zats)),
      reason,
    };
  });

  // Bigger crowd first; on a tie, keep back as little as possible.
  buckets.sort(
    (a, b) =>
      b.crowd.k - a.crowd.k || Number(parseZec(b.amountZec)) - Number(parseZec(a.amountZec)),
  );
  return buckets.slice(0, o.limit);
}
