import { describe, expect, it } from "vitest";
import { recipientHistory, refundHistory, sizeCrowd } from "../src/crowd.ts";
import { suggestBuckets } from "../src/buckets.ts";
import { NOW, USDC, ZEC, ZEC_USD, fixtureFlows } from "./fixtures.ts";

const q = (zec: number) => ({
  usd: zec * ZEC_USD,
  zecAsset: ZEC,
  destinationAsset: USDC,
  now: NOW,
});

describe("sizeCrowd", () => {
  const flows = fixtureFlows();

  it("counts matching deposits and payouts per hour", () => {
    // 48 one-ZEC swaps in 24h = 2/h each side; ±15 min window → 1 + 2 × 2 × 0.25 = 2.
    const c = sizeCrowd(flows, q(1));
    expect(c.inPerHour).toBeCloseTo(2);
    expect(c.outPerHour).toBeCloseTo(2);
    expect(c.k).toBeCloseTo(2);
    expect(c.bits).toBeCloseTo(1);
  });

  it("gives a unique amount a crowd of one", () => {
    const c = sizeCrowd(flows, q(3.417));
    expect(c.k).toBe(1);
    expect(c.bits).toBe(0);
  });

  it("ignores flows outside the lookback", () => {
    // The twenty 3.417 ZEC swaps are 30h old.
    expect(sizeCrowd(flows, q(3.417), { lookbackHours: 48 }).k).toBeGreaterThan(1);
  });

  it("is limited by the thinner side", () => {
    const onlyDeposits = flows.map((f) => ({ ...f, destinationAsset: "elsewhere" }));
    expect(sizeCrowd(onlyDeposits, q(1)).k).toBe(1);
  });

  it("widens with a looser band", () => {
    expect(sizeCrowd(flows, q(1.02), { band: 0.03 }).k).toBeGreaterThan(
      sizeCrowd(flows, q(1.02)).k,
    );
  });

  it("rejects a non-positive value", () => {
    expect(() => sizeCrowd(flows, q(0))).toThrow();
  });

  it("finds recipient and refund history", () => {
    expect(recipientHistory(flows, "R0")).toBe(1);
    expect(recipientHistory(flows, "never-seen")).toBe(0);
    expect(refundHistory(flows, "t1-reused")).toBe(10);
  });
});

describe("suggestBuckets", () => {
  const flows = fixtureFlows();
  const base = { zecUsd: ZEC_USD, zecAsset: ZEC, destinationAsset: USDC, now: NOW };

  it("moves a unique amount to a crowded one and keeps the rest", () => {
    const [best] = suggestBuckets(flows, { ...base, amountZec: "3.417" });
    expect(best?.amountZec).toBe("3");
    expect(best?.holdBackZec).toBe("0.417");
    expect(best!.crowd.k).toBeGreaterThan(1);
  });

  it("never suggests more than the user asked to send", () => {
    for (const b of suggestBuckets(flows, { ...base, amountZec: "3.417" }, { limit: 50 })) {
      expect(Number(b.amountZec)).toBeLessThanOrEqual(3.417);
      expect(Number(b.amountZec)).toBeGreaterThanOrEqual(3.417 * 0.7 - 1e-9);
    }
  });

  it("respects maxHoldBack", () => {
    const list = suggestBuckets(
      flows,
      { ...base, amountZec: "3.417" },
      { maxHoldBack: 0.05, limit: 50 },
    );
    for (const b of list) expect(Number(b.amountZec)).toBeGreaterThanOrEqual(3.417 * 0.95 - 1e-9);
    expect(list.some((b) => b.amountZec === "3")).toBe(false);
  });

  it("keeps an already-crowded amount as is", () => {
    const [best] = suggestBuckets(flows, { ...base, amountZec: "1" });
    expect(best?.amountZec).toBe("1");
    expect(best?.reason).toBe("as-entered");
  });
});
