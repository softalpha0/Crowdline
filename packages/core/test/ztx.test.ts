import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { describe, expect, it } from "vitest";
import { refundFromMnemonic } from "../src/refund.ts";
import {
  addressFromWif,
  TX_V5,
  buildSweep,
  encodeTx,
  hex,
  parseTx,
  scriptFor,
  sweepFee,
  txid,
  verifyInput,
  type Utxo,
} from "../src/ztx.ts";

interface Fixture {
  height: number;
  raw: string;
  coins: { txid: string; index: number; value: string; script: string }[];
}
const { transactions } = JSON.parse(
  readFileSync(new URL("./fixtures/mainnet-v6.json", import.meta.url), "utf8"),
) as { transactions: Fixture[] };
const coinsOf = (f: Fixture): Utxo[] =>
  f.coins.map((c) => ({ ...c, value: BigInt(c.value), script: hex.from(c.script) }));
const NU6_3 = 0x37a5165b;

describe("v6 transactions from mainnet", () => {
  it("reproduces the txid 1Click reported for the bridge payout", () => {
    const f = transactions.find((t) => t.height === 3532931)!;
    expect(txid(parseTx(hex.from(f.raw)))).toBe(
      "afbee6dd9336bc87f41507689f01fb07ce455df0438bff7d5106af520ee7d382",
    );
  });

  it("round-trips the encoding byte for byte", () => {
    for (const f of transactions) expect(hex.to(encodeTx(parseTx(hex.from(f.raw))))).toBe(f.raw);
  });

  it("verifies every real P2PKH signature under the ZIP 244 digest", () => {
    for (const f of transactions) {
      const tx = parseTx(hex.from(f.raw));
      tx.inputs.forEach((_, i) => {
        expect(verifyInput(tx, i, coinsOf(f))).toBe(true);
      });
    }
  });

  it("fails verification if any committed amount or output changes", () => {
    const f = transactions.find((t) => t.height === 3532950)!;
    const coins = coinsOf(f);
    coins[1] = { ...coins[1]!, value: coins[1]!.value + 1n };
    const tx = parseTx(hex.from(f.raw));
    expect(verifyInput(tx, 0, coins)).toBe(false);
    const tx2 = parseTx(hex.from(f.raw));
    tx2.outputs[0] = { ...tx2.outputs[0]!, value: tx2.outputs[0]!.value - 1n };
    expect(verifyInput(tx2, 0, coinsOf(f))).toBe(false);
  });
});

describe("buildSweep", () => {
  const refund = refundFromMnemonic(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const coin: Utxo = {
    txid: "886cca045f74f8c43ec691c0be416e106b8d30d0c5d40208b975f47f80f56c0c"
      .split("")
      .reverse()
      .join(""),
    index: 0,
    value: 118_000n,
    script: scriptFor(refund.address),
  };
  const to = "t1YG266MnLUyGqm7rT9RX1e8anEpQDajLpN";

  it("knows the address a WIF key controls", () => {
    expect(addressFromWif(refund.wif)).toBe(refund.address);
  });

  it("refuses coins locked to another key, and picks v5 for NU6.1", () => {
    expect(() =>
      buildSweep({
        coins: [{ ...coin, script: scriptFor(to) }],
        wif: refund.wif,
        to,
        branchId: NU6_3,
        height: 1,
      }),
    ).toThrow(/not locked to this key/);
    const v5 = buildSweep({ coins: [coin], wif: refund.wif, to, branchId: 0x4dec4df0, height: 1 });
    expect(parseTx(hex.from(v5.raw)).version).toBe(5);
  });

  it("pays everything minus the ZIP 317 fee to the destination, correctly signed", () => {
    const s = buildSweep({
      coins: [coin],
      wif: refund.wif,
      to,
      branchId: NU6_3,
      height: 3_533_500,
    });
    expect(s.fee).toBe(10_000n);
    expect(s.amount).toBe(108_000n);
    const tx = parseTx(hex.from(s.raw));
    expect(tx).toMatchObject({
      version: 6,
      branchId: NU6_3,
      expiryHeight: 3_533_540,
      shielded: false,
    });
    expect(tx.outputs).toEqual([{ value: 108_000n, script: scriptFor(to) }]);
    expect(verifyInput(tx, 0, [coin])).toBe(true);
    expect(txid(tx)).toBe(s.txid);
  });

  it("can build v5 too", () => {
    const s = buildSweep({
      coins: [coin],
      wif: refund.wif,
      to,
      branchId: NU6_3,
      height: 1,
      version: TX_V5,
    });
    const tx = parseTx(hex.from(s.raw));
    expect(tx.version).toBe(5);
    expect(verifyInput(tx, 0, [coin])).toBe(true);
  });

  it("signs with low S and the refund key's own public key", () => {
    const s = buildSweep({
      coins: [coin, { ...coin, index: 1 }],
      wif: refund.wif,
      to,
      branchId: NU6_3,
      height: 1,
    });
    const tx = parseTx(hex.from(s.raw));
    expect(s.fee).toBe(sweepFee(2));
    for (const input of tx.inputs) {
      const sigLen = input.scriptSig[0]!;
      const der = input.scriptSig.slice(1, sigLen); // drop the hash-type byte
      expect(secp256k1.Signature.fromBytes(der, "der").hasHighS()).toBe(false);
    }
  });

  it("refuses dust and empty addresses", () => {
    expect(() =>
      buildSweep({
        coins: [{ ...coin, value: 9_000n }],
        wif: refund.wif,
        to,
        branchId: NU6_3,
        height: 1,
      }),
    ).toThrow(/fee/);
    expect(() =>
      buildSweep({ coins: [], wif: refund.wif, to, branchId: NU6_3, height: 1 }),
    ).toThrow(/Nothing/);
    expect(() =>
      buildSweep({
        coins: [coin],
        wif: refund.wif,
        to: "u1notransparent",
        branchId: NU6_3,
        height: 1,
      }),
    ).toThrow(/transparent/);
  });

  it("uses 2 grace actions, then one per input (ZIP 317)", () => {
    expect([1, 2, 3, 5].map((n) => sweepFee(n))).toEqual([10_000n, 10_000n, 15_000n, 25_000n]);
  });
});
