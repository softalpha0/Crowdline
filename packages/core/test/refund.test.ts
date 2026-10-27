import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { describe, expect, it } from "vitest";
import {
  newOneTimeRefund,
  parseTransparent,
  pubkeyToTransparent,
  refundFromMnemonic,
  refundPath,
} from "../src/refund.ts";
import { depositRequest } from "../src/zip321.ts";

// BIP-39 test vector phrase; never hold funds on it.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("one-time refund keys", () => {
  it("uses the BIP-44 Zcash transparent path", () => {
    expect(refundPath("mainnet")).toBe("m/44'/133'/0'/0/0");
    expect(refundPath("testnet", 3)).toBe("m/44'/1'/0'/0/3");
  });

  it("derives a valid mainnet t1 address deterministically", () => {
    const a = refundFromMnemonic(PHRASE);
    const b = refundFromMnemonic(PHRASE);
    expect(a.address).toBe(b.address);
    expect(a.address.startsWith("t1")).toBe(true);
    expect(a.address).toHaveLength(35);
    expect(parseTransparent(a.address)).toEqual({ network: "mainnet", kind: "p2pkh" });
    expect(a.wif.startsWith("K") || a.wif.startsWith("L")).toBe(true);
  });

  it("derives testnet tm addresses", () => {
    const t = refundFromMnemonic(PHRASE, "testnet");
    expect(t.address.startsWith("tm")).toBe(true);
    expect(parseTransparent(t.address)?.network).toBe("testnet");
  });

  it("encodes the secp256k1 generator's pubkey to a known address", () => {
    // Private key 1 → compressed pubkey G. hash160(G) = 751e76e8199196d454941c45d1b3a323f1433bd6,
    // the well-known Bitcoin vector; with Zcash's 0x1cb8 prefix it must start with t1.
    const g = Uint8Array.from(
      Buffer.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex"),
    );
    // Expected value computed separately in Python (hashlib + hand-rolled base58check),
    // which also reproduces the Bitcoin address 1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH.
    expect(pubkeyToTransparent(g)).toBe("t1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs");
  });

  it("matches an independent derivation of the same key", () => {
    const r = refundFromMnemonic(PHRASE);
    const node = HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE)).derive("m/44'/133'/0'/0/0");
    expect(pubkeyToTransparent(node.publicKey!)).toBe(r.address);
  });

  it("makes a different 24-word phrase every time", () => {
    const a = newOneTimeRefund();
    const b = newOneTimeRefund();
    expect(a.mnemonic.split(" ")).toHaveLength(24);
    expect(a.address).not.toBe(b.address);
  });

  it("rejects invalid input", () => {
    expect(() => refundFromMnemonic("not a phrase")).toThrow();
    expect(parseTransparent("u1notTransparent")).toBeNull();
    expect(parseTransparent("t1abc")).toBeNull();
  });
});

describe("ZIP-321 deposit request", () => {
  const addr = refundFromMnemonic(PHRASE).address;

  it("builds a memo-free request for a transparent address", () => {
    expect(depositRequest(addr, 300_000_000n)).toBe(`zcash:${addr}?amount=3`);
    expect(depositRequest(addr, 341_700_000n)).toBe(`zcash:${addr}?amount=3.417`);
  });

  it("refuses non-transparent or empty payments", () => {
    expect(() => depositRequest("u1xyz", 1n)).toThrow();
    expect(() => depositRequest(addr, 0n)).toThrow();
  });
});
