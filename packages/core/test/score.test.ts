import { describe, expect, it } from "vitest";
import { auditIntent } from "../src/score.ts";
import type { SwapIntent } from "../src/types.ts";
import { NOW, USDC, ZEC, ZEC_USD, fixtureFlows } from "./fixtures.ts";

const flows = fixtureFlows();
const ctx = { flows, zecAsset: ZEC, now: NOW };
const typical: SwapIntent = {
  amountZec: 3.417,
  zecUsd: ZEC_USD,
  destinationAsset: USDC,
  recipient: "r0",
  confidentiality: "public",
  funding: "transparent-reused",
  refund: "reused",
};

describe("auditIntent", () => {
  it("caps a public swap at 10 and flags the ledger link first", () => {
    const r = auditIntent(
      { ...typical, amountZec: 1, funding: "shielded", refund: "one-time", recipient: "fresh" },
      ctx,
    );
    expect(r.score).toBeLessThanOrEqual(10);
    expect(r.findings[0]).toMatchObject({ id: "ledger-link", severity: "critical" });
  });

  it("reports every leak in a typical swap", () => {
    const r = auditIntent(typical, { ...ctx, refundTo: "t1-reused" });
    const by = Object.fromEntries(r.findings.map((f) => [f.id, f.severity]));
    expect(by).toEqual({
      "ledger-link": "critical",
      amount: "critical",
      refund: "high",
      funding: "high",
      recipient: "medium",
    });
    expect(r.findings.find((f) => f.id === "refund")?.detail).toContain("10 past swaps");
  });

  it("scores the hardened swap well above the typical one", () => {
    const before = auditIntent(typical, ctx);
    const after = auditIntent(
      {
        ...typical,
        amountZec: 3,
        confidentiality: "basic",
        funding: "shielded",
        refund: "one-time",
        recipient: "fresh",
      },
      ctx,
    );
    expect(before.score).toBeLessThanOrEqual(10);
    expect(after.score).toBeGreaterThan(before.score + 30);
    // Everything Crowdline controls is fixed; only crowd size is left to chance.
    const left = after.findings.filter((f) => f.severity !== "ok").map((f) => f.id);
    expect(left).toEqual(["amount"]);
    expect(after.crowd.k).toBeGreaterThan(before.crowd.k);
  });

  it("scores between 0 and 100", () => {
    for (const confidentiality of ["public", "basic"] as const) {
      for (const amountZec of [0.137, 1, 3, 3.417, 999]) {
        const r = auditIntent({ ...typical, confidentiality, amountZec }, ctx);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("the README's worked example", () => {
  it("scores 1 ZEC, hardened, on the fixture at 52/100", () => {
    // 48 swaps of 1 ZEC ($300) into USDC in 24h: 2 per hour on both sides.
    const r = auditIntent(
      {
        ...typical,
        amountZec: 1,
        recipient: "fresh",
        confidentiality: "basic",
        funding: "shielded",
        refund: "one-time",
      },
      ctx,
    );
    expect(r.crowd.inPerHour).toBeCloseTo(2, 5);
    expect(r.crowd.outPerHour).toBeCloseTo(2, 5);
    expect(r.crowd.k).toBeCloseTo(2, 5); // 1 + 2 × 2 × 0.25
    expect(r.crowd.bits).toBeCloseTo(1, 5); // log2(2)
    expect(r.score).toBe(52); // 60 × 1/5 + 15 + 15 + 10
  });
});
