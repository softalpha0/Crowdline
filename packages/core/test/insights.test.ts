import { describe, expect, it } from "vitest";
import { backtest, compareRoutes, crowdByHour, topDestinations } from "../src/insights.ts";
import type { Flow } from "../src/types.ts";
import { NOW, USDC, ZEC, fixtureFlows } from "./fixtures.ts";

// Midnight UTC on the fixture day, so "the last 3 days" holds exactly 3 whole days.
const DAY0 = Math.floor(NOW / 86400) * 86400;
const at = (hourUtc: number, dayAgo: number) => DAY0 - dayAgo * 86400 + hourUtc * 3600 + 600;
const swap = (p: Partial<Flow>): Flow => ({
  t: NOW - 60,
  originAsset: ZEC,
  destinationAsset: USDC,
  amountIn: 1,
  amountInUsd: 300,
  amountOutUsd: 299.4,
  recipient: "r",
  refundTo: "t",
  status: "SUCCESS",
  ...p,
});

describe("crowdByHour", () => {
  // Three days; $300 swaps cluster at 14:00 UTC (4 a day) and once a day at 03:00.
  const flows: Flow[] = [];
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 4; i++) flows.push(swap({ t: at(14, d + 1) + i * 60 }));
    flows.push(swap({ t: at(3, d + 1) }));
  }

  it("averages matching swaps per hour of day and ranks the best hours", () => {
    const r = crowdByHour(flows, {
      usd: 300,
      zecAsset: ZEC,
      destinationAsset: USDC,
      now: DAY0,
      days: 3,
    });
    expect(r.hours).toHaveLength(24);
    expect(r.hours[14]).toMatchObject({ inPerHour: 4, outPerHour: 4, k: 3 }); // 1 + 4 × 2 × 0.25
    expect(r.hours[3]!.k).toBeCloseTo(1.5, 5);
    expect(r.hours[9]!.k).toBe(1);
    expect(r.best.slice(0, 2)).toEqual([14, 3]);
  });

  it("ignores swaps of other sizes and outside the window", () => {
    const r = crowdByHour(
      [
        ...flows,
        swap({ t: at(14, 1), amountInUsd: 900, amountOutUsd: 898 }),
        swap({ t: at(14, 9) }),
      ],
      {
        usd: 300,
        zecAsset: ZEC,
        destinationAsset: USDC,
        now: DAY0,
        days: 3,
      },
    );
    expect(r.hours[14]!.inPerHour).toBe(4);
  });
});

describe("compareRoutes and topDestinations", () => {
  const OTHER = "nep141:usdt.test";
  const flows = fixtureFlows();
  const otherFlows = [
    ...flows,
    ...Array.from({ length: 96 }, (_, i) => swap({ t: NOW - i * 900, destinationAsset: OTHER })),
  ];

  it("ranks the route where the same swap hides best first", () => {
    const r = compareRoutes(
      [
        { destinationAsset: USDC, flows },
        { destinationAsset: OTHER, flows: otherFlows },
      ],
      { usd: 300, zecAsset: ZEC, now: NOW },
    );
    expect(r.map((x) => x.destinationAsset)).toEqual([OTHER, USDC]);
    expect(r[0]!.crowd.k).toBeGreaterThan(r[1]!.crowd.k);
    expect(r[0]!.zecSwaps).toBe(96);
  });

  it("lists the destinations people actually use", () => {
    expect(topDestinations(otherFlows, ZEC, 2)).toEqual([OTHER, USDC]);
  });
});

describe("backtest", () => {
  it("counts the payouts an observer cannot tell apart from the true one", () => {
    const flows = [
      // two $300 swaps 5 minutes apart: each has 2 candidates
      swap({ t: NOW - 3000 }),
      swap({ t: NOW - 2700, recipient: "b" }),
      // a lone $1,234 swap: uniquely linked
      swap({ t: NOW - 20000, amountInUsd: 1234, amountOutUsd: 1231 }),
      // high fees push the true payout out of the ±1% band
      swap({ t: NOW - 40000, amountInUsd: 2, amountOutUsd: 1.7 }),
    ];
    const r = backtest(flows, { zecAsset: ZEC, now: NOW });
    expect(r.swaps).toBe(4);
    expect(r.trueInBand).toBe(0.75);
    expect(r.uniquelyLinked).toBe(0.25);
    expect(r.medianCandidates).toBe(2); // candidates 0, 1, 2, 2: upper median
  });

  it("is empty, not invented, without data", () => {
    expect(backtest([], { zecAsset: ZEC, now: NOW })).toMatchObject({
      swaps: 0,
      uniquelyLinked: 0,
    });
  });
});
