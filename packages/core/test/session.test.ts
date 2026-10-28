import { describe, expect, it } from "vitest";
import { openSession, readSealed, sealSession } from "../src/session.ts";

const fast = { iterations: 1000 };

describe("encrypted session", () => {
  const value = { mnemonic: "abandon ability able about", quote: { depositAddress: "t1x" }, n: 5n };

  it("round-trips with the right passphrase", async () => {
    const s = await sealSession(value, "correct horse", fast);
    expect(await openSession(s, "correct horse", fast)).toEqual({ ...value, n: "5" });
  });

  it("does not store the plaintext and refuses the wrong passphrase", async () => {
    const s = await sealSession(value, "correct horse", fast);
    expect(JSON.stringify(s)).not.toContain("abandon");
    await expect(openSession(s, "wrong horse!", fast)).rejects.toThrow(/Wrong passphrase/);
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = await sealSession(value, "correct horse", fast);
    const b = await sealSession(value, "correct horse", fast);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects short passphrases and junk storage", async () => {
    await expect(sealSession(value, "short", fast)).rejects.toThrow(/8 characters/);
    expect(readSealed(null)).toBeNull();
    expect(readSealed("{not json")).toBeNull();
    expect(readSealed('{"v":1}')).toBeNull();
  });
});
