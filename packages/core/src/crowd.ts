import type { Crowd, CrowdOptions, Flow } from "./types.ts";
import { DEFAULT_CROWD } from "./types.ts";

export interface CrowdQuery {
  /** USD value of the swap being sized. */
  usd: number;
  /** 1Click asset id for ZEC; deposits are matched against this origin. */
  zecAsset: string;
  /** Destination asset of the swap; outputs are matched against this. */
  destinationAsset: string;
  /** Reference time (unix seconds). Defaults to the newest flow. */
  now?: number;
}

function within(value: number, target: number, band: number): boolean {
  return Math.abs(value - target) <= target * band;
}

/**
 * Size the crowd a swap hides in.
 *
 * An observer who sees your ZEC deposit on Zcash and your payout on the
 * destination chain links them by USD value and timing. The swaps that look
 * the same to them are:
 *   - deposits from Zcash with a USD value inside `band` of yours, and
 *   - payouts of the same destination asset with a value inside `band`.
 * You are hidden only as well as the thinner of those two crowds. The
 * expected size of that crowd inside a ±windowHours search is
 * 1 + min(inRate, outRate) × 2 × windowHours, counting yourself.
 */
export function sizeCrowd(flows: Flow[], q: CrowdQuery, opts: Partial<CrowdOptions> = {}): Crowd {
  const o = { ...DEFAULT_CROWD, ...opts };
  if (!(q.usd > 0)) throw new Error("Swap value must be positive");

  const now = q.now ?? flows.reduce((m, f) => Math.max(m, f.t), 0);
  const since = now - o.lookbackHours * 3600;
  const recent = flows.filter((f) => f.t > since && f.t <= now);

  let inMatches = 0;
  let outMatches = 0;
  for (const f of recent) {
    if (f.originAsset === q.zecAsset && within(f.amountInUsd, q.usd, o.band)) inMatches++;
    if (f.destinationAsset === q.destinationAsset && within(f.amountOutUsd, q.usd, o.band)) {
      outMatches++;
    }
  }

  const inPerHour = inMatches / o.lookbackHours;
  const outPerHour = outMatches / o.lookbackHours;
  const k = 1 + Math.min(inPerHour, outPerHour) * 2 * o.windowHours;
  return { inPerHour, outPerHour, k, bits: Math.log2(k) };
}

/** How many past swaps already paid this recipient. */
export function recipientHistory(flows: Flow[], recipient: string): number {
  const needle = recipient.trim().toLowerCase();
  if (!needle) return 0;
  return flows.filter((f) => f.recipient.toLowerCase() === needle).length;
}

/** How many past swaps already refunded to this address. */
export function refundHistory(flows: Flow[], refundTo: string): number {
  const needle = refundTo.trim();
  if (!needle) return 0;
  return flows.filter((f) => f.refundTo === needle).length;
}
