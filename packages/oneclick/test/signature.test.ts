import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quoteMessage, stableStringify, verifyQuoteSignature } from "../src/signature.ts";

// A real dry quote recorded from 1click.chaindefuser.com on 2026-10-27.
const recorded = JSON.parse(
  readFileSync(new URL("./fixtures/quote-dry-public.json", import.meta.url), "utf8"),
) as {
  signature: string;
  timestamp: string;
  quoteRequest: Record<string, unknown>;
  quote: Record<string, unknown>;
};
const clone = () => structuredClone(recorded);

describe("stableStringify", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [1, undefined], c: "x" }, z: undefined })).toBe(
      '{"a":{"c":"x","d":[1,null]},"b":1}',
    );
  });
});

describe("verifyQuoteSignature", () => {
  it("accepts a real quote signed by 1Click", () => {
    expect(verifyQuoteSignature(recorded)).toBe(true);
  });

  it("rejects a changed payout amount", () => {
    const q = clone();
    q.quote.amountOut = "99999999";
    expect(verifyQuoteSignature(q)).toBe(false);
  });

  it("rejects a changed recipient or refund address", () => {
    const a = clone();
    a.quoteRequest.recipient = "AttackerWallet1111111111111111111111111111";
    expect(verifyQuoteSignature(a)).toBe(false);
    const b = clone();
    b.quoteRequest.refundTo = "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU";
    expect(verifyQuoteSignature(b)).toBe(false);
  });

  it("rejects a changed timestamp", () => {
    const q = clone();
    q.timestamp = "2026-10-27T16:01:26.503Z";
    expect(verifyQuoteSignature(q)).toBe(false);
  });

  it("rejects another key and malformed input without throwing", () => {
    expect(verifyQuoteSignature(recorded, "ed25519:11111111111111111111111111111111")).toBe(false);
    expect(verifyQuoteSignature({})).toBe(false);
    expect(verifyQuoteSignature(null)).toBe(false);
    expect(verifyQuoteSignature({ ...recorded, signature: "ed25519:notbase58!" })).toBe(false);
  });

  it("does not cover confidentiality, so it is checked separately", () => {
    const q = clone();
    q.quoteRequest.confidentiality = "basic";
    expect(verifyQuoteSignature(q)).toBe(true);
    expect(quoteMessage(q)).toBe(quoteMessage(recorded));
  });
});

// The real confidential quote from the first mainnet run (evidence/run-01).
const live = JSON.parse(
  readFileSync(new URL("./fixtures/quote-live-basic.json", import.meta.url), "utf8"),
) as typeof recorded;

describe("verifyQuoteSignature on an executed mainnet quote", () => {
  it("accepts the signed confidential quote from run 01", () => {
    expect(live.quoteRequest.dry).toBe(false);
    expect(live.quoteRequest.confidentiality).toBe("basic");
    expect(verifyQuoteSignature(live)).toBe(true);
  });

  it("covers the deposit address, so a swapped one is caught", () => {
    const q = structuredClone(live);
    q.quote.depositAddress = "t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs";
    expect(verifyQuoteSignature(q)).toBe(false);
  });
});
