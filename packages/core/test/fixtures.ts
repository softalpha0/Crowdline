import type { Flow } from "../src/types.ts";

export const ZEC = "nep141:zec.test";
export const USDC = "nep141:usdc.test";
export const NOW = 1_800_000_000;
export const ZEC_USD = 300;

function flow(p: Partial<Flow> & Pick<Flow, "amountIn">): Flow {
  const usd = p.amountInUsd ?? p.amountIn * ZEC_USD;
  return {
    t: NOW - 600,
    originAsset: ZEC,
    destinationAsset: USDC,
    amountInUsd: usd,
    amountOutUsd: usd * 0.997,
    recipient: "r-unique",
    refundTo: "t1-unique",
    status: "SUCCESS",
    ...p,
  };
}

/**
 * 24 hours of activity: 48 swaps of exactly 1 ZEC ($300) and 12 of 3 ZEC
 * ($900) out of Zcash into USDC, plus a scattering of odd amounts.
 */
export function fixtureFlows(): Flow[] {
  const flows: Flow[] = [];
  for (let i = 0; i < 48; i++)
    flows.push(flow({ amountIn: 1, t: NOW - i * 1800, recipient: `r${i}` }));
  for (let i = 0; i < 12; i++)
    flows.push(flow({ amountIn: 3, t: NOW - i * 7200, recipient: `s${i}` }));
  for (let i = 0; i < 10; i++) {
    flows.push(
      flow({
        amountIn: 0.137 + i * 0.611,
        t: NOW - i * 3000,
        recipient: `odd${i}`,
        refundTo: "t1-reused",
      }),
    );
  }
  // Older than the 24h lookback: must be ignored.
  for (let i = 0; i < 20; i++) flows.push(flow({ amountIn: 3.417, t: NOW - 30 * 3600 - i }));
  return flows;
}
