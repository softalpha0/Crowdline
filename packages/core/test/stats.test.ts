import { describe, expect, it } from "vitest";
import { swapStats } from "../src/stats.ts";
import { NOW, USDC, ZEC, fixtureFlows } from "./fixtures.ts";

describe("swapStats", () => {
  const stats = swapStats(fixtureFlows(), { zecAsset: ZEC, now: NOW });

  it("counts Zcash-origin swaps inside the window only", () => {
    // 48 + 12 + 10 inside 24h; the 20 older swaps are ignored.
    expect(stats.zecSwaps).toBe(70);
    expect(stats.lookbackHours).toBe(24);
  });

  it("ranks repeated exact amounts and sizes their crowd", () => {
    expect(stats.commonAmounts.map((c) => [c.amountZec, c.count])).toEqual([
      [1, 48],
      [3, 12],
    ]);
    const one = stats.commonAmounts[0]!;
    expect(one.destinationAsset).toBe(USDC);
    // 48 in 24h = 2/h; k = 1 + 2 × 2 × 0.25 = 2.
    expect(one.crowd).toBeCloseTo(2, 5);
    expect(stats.medianCommonCrowd).toBeCloseTo((2 + 1.25) / 2, 5);
  });

  it("reports volume and median size", () => {
    expect(stats.medianSwapUsd).toBe(300);
    expect(stats.zecVolumeUsd).toBeGreaterThan(48 * 300 + 12 * 900);
  });

  it("is empty, not invented, with no data", () => {
    const empty = swapStats([], { zecAsset: ZEC, now: NOW });
    expect(empty).toMatchObject({ zecSwaps: 0, zecVolumeUsd: 0, medianSwapUsd: 0 });
    expect(empty.commonAmounts).toEqual([]);
  });
});
