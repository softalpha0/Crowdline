import { DEMO_DESTINATIONS, DEMO_ZEC_ASSET, demoFlows } from "@crowdline/core";
import { describe, expect, it } from "vitest";
import { parseAuditRequest, runAudit } from "../src/audit.ts";

const NOW = 1_800_000_000;
const flows = demoFlows({ now: NOW, zecUsd: 300 });

describe("parseAuditRequest", () => {
  it("applies defaults and validates", () => {
    const r = parseAuditRequest({ amountZec: "3.417", destinationAsset: "x" });
    expect(r).toMatchObject({ confidentiality: "public", funding: "shielded", refund: "reused" });
    expect(() => parseAuditRequest({ amountZec: "abc", destinationAsset: "x" })).toThrow();
    expect(() => parseAuditRequest({ amountZec: "1", destinationAsset: "" })).toThrow();
    expect(() =>
      parseAuditRequest({ amountZec: "1", destinationAsset: "x", funding: "?" }),
    ).toThrow();
    expect(() =>
      parseAuditRequest({ amountZec: "1", destinationAsset: "x", maxHoldBack: 0.9 }),
    ).toThrow();
  });
});

describe("runAudit on demo flows", () => {
  it("hardens a typical swap", () => {
    const req = parseAuditRequest({
      amountZec: "3.417",
      destinationAsset: DEMO_DESTINATIONS[0],
      recipient: "fresh-recipient",
      confidentiality: "public",
      funding: "transparent-reused",
      refund: "reused",
    });
    const out = runAudit(req, { flows, zecAsset: DEMO_ZEC_ASSET, zecUsd: 300 });
    expect(out.before.score).toBeLessThanOrEqual(10);
    expect(out.hardened).toMatchObject({
      confidentiality: "basic",
      funding: "shielded",
      refund: "one-time",
    });
    expect(out.hardened.amountZec).toBeLessThanOrEqual(3.417);
    expect(out.after.score).toBeGreaterThan(out.before.score);
    expect(out.after.crowd.k).toBeGreaterThanOrEqual(out.before.crowd.k);
  });
});

describe("funding recency in the audit", () => {
  const ctx = { flows, zecAsset: DEMO_ZEC_ASSET, zecUsd: 300 };
  const req = (over: Record<string, unknown>) =>
    parseAuditRequest({ amountZec: "3.417", destinationAsset: DEMO_DESTINATIONS[0], ...over });

  it("flags money shielded minutes ago, before and after hardening", () => {
    const out = runAudit(req({ funding: "shielded", shieldedAge: "under-hour" }), ctx);
    expect(out.before.findings.some((f) => f.id === "timing")).toBe(true);
    expect(out.after.findings.some((f) => f.id === "timing")).toBe(true);
    expect(() => req({ shieldedAge: "yesterday" })).toThrow(/shieldedAge/);
  });

  it("does not pretend that shielding right now is old money", () => {
    const out = runAudit(req({ funding: "transparent-reused" }), ctx);
    expect(out.hardened.shieldedAge).toBe("under-hour");
  });
});
