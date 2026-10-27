import { describe, expect, it } from "vitest";
import { buildReceipt, parseReceipt } from "../src/receipt.ts";
import { newOneTimeRefund } from "../src/refund.ts";

describe("buildReceipt", () => {
  const refund = newOneTimeRefund("mainnet");
  const crowd = { inPerHour: 1, outPerHour: 1, k: 1.5, bits: 0.58 };
  // Pass the whole refund object, key and all, as a careless caller would.
  const receipt = buildReceipt({
    crowdData: "live",
    before: { score: 10, crowd, findings: [] },
    after: { score: 61, crowd },
    chosenAmountZec: "0.05",
    refund,
    quote: { signature: "ed25519:x" },
    signatureValid: true,
    now: new Date("2026-10-27T12:00:00Z"),
  });
  const text = JSON.stringify(receipt);

  it("never contains the recovery phrase or the WIF key", () => {
    expect(text).not.toContain(refund.wif);
    // Any two consecutive words of the phrase would be a leak. (Single words
    // can collide with field names: "before" is a BIP-39 word.)
    const words = refund.mnemonic.split(" ");
    for (let i = 0; i + 1 < words.length; i++) {
      expect(text).not.toContain(`${words[i]} ${words[i + 1]}`);
    }
    expect(text).not.toContain(refund.mnemonic);
    expect(text).not.toMatch(/mnemonic|wif/i);
  });

  it("has a fixed shape", () => {
    expect(Object.keys(receipt).sort()).toEqual(
      [
        "after",
        "app",
        "before",
        "chosenAmountZec",
        "createdAt",
        "crowdData",
        "quote",
        "refundAddress",
        "refundPath",
        "signatureValid",
        "status",
        "version",
      ].sort(),
    );
    expect(receipt).toMatchObject({
      app: "crowdline",
      version: 1,
      createdAt: "2026-10-27T12:00:00.000Z",
      refundAddress: refund.address,
      refundPath: "m/44'/133'/0'/0/0",
    });
  });

  it("round-trips through parseReceipt and rejects other JSON", () => {
    expect(parseReceipt(text).refundAddress).toBe(refund.address);
    expect(() => parseReceipt('{"app":"other"}')).toThrow(/Crowdline/);
    expect(() => parseReceipt("not json")).toThrow();
  });
});
