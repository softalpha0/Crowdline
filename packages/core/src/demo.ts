import type { Flow } from "./types.ts";

/**
 * Synthetic flows for running Crowdline without an Explorer API key.
 *
 * These are NOT real swaps. They are shaped like the real thing (people
 * favour round amounts, most volume goes to a few stablecoins) so the UI and
 * the maths can be exercised offline. Anything computed on them is labelled
 * "demo" wherever it is shown.
 */

export const DEMO_ZEC_ASSET = "nep141:zec.omft.near";
export const DEMO_DESTINATIONS: readonly [string, string, string, string] = [
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", // USDC on Solana
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", // USDC on Ethereum
  "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", // USDT on Tron
  "nep141:btc.omft.near", // BTC
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted: 1, 5 and 10 ZEC are far more common than 0.25 or 50.
const ROUND_ZEC = [
  0.1, 0.25, 0.5, 0.5, 1, 1, 1, 1, 1.5, 2, 2, 2.5, 3, 3, 4, 5, 5, 5, 7.5, 10, 10, 15, 20, 25, 50,
];

export function demoFlows(opts: {
  now: number;
  hours?: number;
  zecUsd?: number;
  seed?: number;
}): Flow[] {
  const { now, hours = 24, zecUsd = 300, seed = 7 } = opts;
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const flows: Flow[] = [];

  const zecSwaps = Math.round(hours * 120);
  for (let i = 0; i < zecSwaps; i++) {
    // 60% of people send a round amount, the rest something arbitrary.
    const amountIn =
      rnd() < 0.6 ? pick(ROUND_ZEC) : Number((Math.exp(rnd() * 5 - 2) * 1.3).toFixed(4));
    const usd = amountIn * zecUsd * (0.995 + rnd() * 0.01);
    const dest = rnd() < 0.6 ? DEMO_DESTINATIONS[0] : pick(DEMO_DESTINATIONS);
    flows.push({
      t: Math.round(now - rnd() * hours * 3600),
      originAsset: DEMO_ZEC_ASSET,
      destinationAsset: dest,
      amountIn,
      amountInUsd: usd,
      amountOutUsd: usd * 0.996,
      recipient: `demo-recipient-${Math.floor(rnd() * 5000)}`,
      refundTo: `t1demoRefund${Math.floor(rnd() * 800)}`,
      status: "SUCCESS",
    });
  }

  // Payouts of the same assets that started on other chains also hide yours.
  const otherSwaps = Math.round(hours * 300);
  for (let i = 0; i < otherSwaps; i++) {
    const usd = rnd() < 0.5 ? pick([50, 100, 200, 250, 500, 1000, 2000]) : Math.exp(rnd() * 8);
    flows.push({
      t: Math.round(now - rnd() * hours * 3600),
      originAsset: "nep141:demo-other-origin",
      destinationAsset: pick(DEMO_DESTINATIONS),
      amountIn: usd,
      amountInUsd: usd,
      amountOutUsd: usd * 0.997,
      recipient: `demo-recipient-${Math.floor(rnd() * 5000)}`,
      refundTo: `demo-refund-${i}`,
      status: "SUCCESS",
    });
  }

  return flows.sort((a, b) => b.t - a.t);
}
