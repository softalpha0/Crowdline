import { secp256k1 } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2";
import { sha256 } from "@noble/hashes/sha2";
import { createBase58check } from "@scure/base";
import { parseTransparent, pubkeyToTransparent } from "./refund.ts";

/**
 * Transparent-only Zcash transactions, version 5 (ZIP 225) and version 6
 * (ZIP 229, NU6.3), with ZIP 244 transaction ids and signature digests.
 * Enough to sweep a one-time refund address; nothing shielded is built here.
 */

const b58c = createBase58check(sha256);
const enc = new TextEncoder();

export const TX_V5 = { version: 5, versionGroupId: 0x26a7270a } as const;
export const TX_V6 = { version: 6, versionGroupId: 0xd884b698 } as const;
export const SIGHASH_ALL = 0x01;
/** ZIP 317: 5,000 zatoshi per logical action, at least 2 actions. */
export const MARGINAL_FEE = 5000n;
export const GRACE_ACTIONS = 2;

export interface TxIn {
  /** Previous txid in display order (as explorers and wallets show it). */
  txid: string;
  index: number;
  scriptSig: Uint8Array;
  sequence: number;
}

export interface TxOut {
  value: bigint;
  script: Uint8Array;
}

export interface TransparentTx {
  version: 5 | 6;
  versionGroupId: number;
  branchId: number;
  lockTime: number;
  expiryHeight: number;
  inputs: TxIn[];
  outputs: TxOut[];
}

/** A coin to spend: what lightwalletd's GetAddressUtxos returns, normalised. */
export interface Utxo {
  txid: string;
  index: number;
  value: bigint;
  script: Uint8Array;
}

// ───────────────────────── bytes ─────────────────────────

export const hex = {
  to: (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""),
  from: (s: string) => {
    if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error("Not hex");
    return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
  },
};

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
const i64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
};

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return concat([Uint8Array.of(0xfe), u32(n)]);
}

const withLength = (b: Uint8Array) => concat([compactSize(b.length), b]);
const reversed = (b: Uint8Array) => Uint8Array.from(b).reverse();

class Reader {
  private i = 0;
  private readonly v: DataView;
  constructor(private readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  get done(): boolean {
    return this.i === this.b.length;
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new Error("Transaction is truncated");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0] ?? 0;
  }
  u32(): number {
    const n = this.v.getUint32(this.i, true);
    this.i += 4;
    return n;
  }
  i64(): bigint {
    const n = this.v.getBigInt64(this.i, true);
    this.i += 8;
    return n;
  }
  compact(): number {
    const f = this.u8();
    if (f < 0xfd) return f;
    if (f === 0xfd) {
      const n = this.v.getUint16(this.i, true);
      this.i += 2;
      return n;
    }
    if (f === 0xfe) return this.u32();
    throw new Error("compactSize too large");
  }
}

// ───────────────────────── encoding ─────────────────────────

function encodeInputs(inputs: TxIn[]): Uint8Array {
  return concat([
    compactSize(inputs.length),
    ...inputs.map((x) =>
      concat([reversed(hex.from(x.txid)), u32(x.index), withLength(x.scriptSig), u32(x.sequence)]),
    ),
  ]);
}

function encodeOutputs(outputs: TxOut[]): Uint8Array {
  return concat([
    compactSize(outputs.length),
    ...outputs.map((o) => concat([i64(o.value), withLength(o.script)])),
  ]);
}

/** Serialise a transparent-only v5 or v6 transaction. */
export function encodeTx(tx: TransparentTx): Uint8Array {
  const emptyShielded =
    tx.version === 6
      ? Uint8Array.of(0, 0, 0, 0) // Sapling spends, Sapling outputs, Orchard actions, Ironwood actions
      : Uint8Array.of(0, 0, 0); // Sapling spends, Sapling outputs, Orchard actions
  return concat([
    u32((0x80000000 | tx.version) >>> 0),
    u32(tx.versionGroupId),
    u32(tx.branchId),
    u32(tx.lockTime),
    u32(tx.expiryHeight),
    encodeInputs(tx.inputs),
    encodeOutputs(tx.outputs),
    emptyShielded,
  ]);
}

/**
 * Parse a v5 or v6 transaction. Returns `shielded: true` (and only the
 * transparent part) when it has Sapling, Orchard or Ironwood components.
 */
export function parseTx(raw: Uint8Array): TransparentTx & { shielded: boolean } {
  const r = new Reader(raw);
  const header = r.u32();
  const version = header & 0x7fffffff;
  if (!(header >>> 31) || (version !== 5 && version !== 6)) {
    throw new Error(`Only v5 and v6 transactions are supported (got v${version})`);
  }
  const versionGroupId = r.u32();
  const branchId = r.u32();
  const lockTime = r.u32();
  const expiryHeight = r.u32();
  const inputs: TxIn[] = [];
  for (let n = r.compact(); n > 0; n--) {
    const txid = hex.to(reversed(r.bytes(32)));
    const index = r.u32();
    const scriptSig = r.bytes(r.compact());
    inputs.push({ txid, index, scriptSig, sequence: r.u32() });
  }
  const outputs: TxOut[] = [];
  for (let n = r.compact(); n > 0; n--) {
    const value = r.i64();
    outputs.push({ value, script: r.bytes(r.compact()) });
  }
  const counts: number[] = [r.compact(), r.compact(), r.compact()];
  if (version === 6 && !counts.some((c) => c > 0)) counts.push(r.compact());
  const shielded = counts.some((c) => c > 0);
  if (!shielded && !r.done) throw new Error("Unexpected trailing bytes");
  return {
    version,
    versionGroupId,
    branchId,
    lockTime,
    expiryHeight,
    inputs,
    outputs,
    shielded,
  };
}

// ───────────────────────── ZIP 244 / ZIP 229 digests ─────────────────────────

function h(personal: string, ...data: Uint8Array[]): Uint8Array {
  const p = enc.encode(personal);
  if (p.length !== 16) throw new Error(`Bad personalization ${personal}`);
  return blake2b(concat(data), { dkLen: 32, personalization: p });
}

function headerDigest(tx: TransparentTx): Uint8Array {
  return h(
    "ZTxIdHeadersHash",
    u32((0x80000000 | tx.version) >>> 0),
    u32(tx.versionGroupId),
    u32(tx.branchId),
    u32(tx.lockTime),
    u32(tx.expiryHeight),
  );
}

const outpoint = (x: TxIn) => concat([reversed(hex.from(x.txid)), u32(x.index)]);
const prevoutsDigest = (tx: TransparentTx) => h("ZTxIdPrevoutHash", ...tx.inputs.map(outpoint));
const sequenceDigest = (tx: TransparentTx) =>
  h("ZTxIdSequencHash", ...tx.inputs.map((x) => u32(x.sequence)));
const outputsDigest = (tx: TransparentTx) =>
  h("ZTxIdOutputsHash", ...tx.outputs.map((o) => concat([i64(o.value), withLength(o.script)])));

/** The shielded component digests of a transaction that has none. */
function emptyShieldedDigests(tx: TransparentTx): Uint8Array[] {
  return tx.version === 6
    ? [h("ZTxIdSaplingHash"), h("ZTxIdOrchardH_v6"), h("ZTxIdIronwd_H_v6")]
    : [h("ZTxIdSaplingHash"), h("ZTxIdOrchardHash")];
}

function topPersonal(tx: TransparentTx): Uint8Array {
  const p = new Uint8Array(16);
  p.set(enc.encode("ZcashTxHash_"));
  p.set(u32(tx.branchId), 12);
  return p;
}

function top(tx: TransparentTx, ...parts: Uint8Array[]): Uint8Array {
  return blake2b(concat(parts), { dkLen: 32, personalization: topPersonal(tx) });
}

/** Transaction id in display order. Transparent-only transactions only. */
export function txid(tx: TransparentTx): string {
  const transparent =
    tx.inputs.length || tx.outputs.length
      ? h("ZTxIdTranspaHash", prevoutsDigest(tx), sequenceDigest(tx), outputsDigest(tx))
      : h("ZTxIdTranspaHash");
  return hex.to(reversed(top(tx, headerDigest(tx), transparent, ...emptyShieldedDigests(tx))));
}

/** ZIP 244 signature digest for transparent input `index`, SIGHASH_ALL. */
export function sighash(tx: TransparentTx, index: number, coins: Utxo[]): Uint8Array {
  if (coins.length !== tx.inputs.length) throw new Error("Need one coin per input");
  const input = tx.inputs[index];
  const coin = coins[index];
  if (!input || !coin) throw new Error("No such input");
  const transparentSig = h(
    "ZTxIdTranspaHash",
    Uint8Array.of(SIGHASH_ALL),
    prevoutsDigest(tx),
    h("ZTxTrAmountsHash", ...coins.map((c) => i64(c.value))),
    h("ZTxTrScriptsHash", ...coins.map((c) => withLength(c.script))),
    sequenceDigest(tx),
    outputsDigest(tx),
    h(
      "Zcash___TxInHash",
      outpoint(input),
      i64(coin.value),
      withLength(coin.script),
      u32(input.sequence),
    ),
  );
  return top(tx, headerDigest(tx), transparentSig, ...emptyShieldedDigests(tx));
}

// ───────────────────────── scripts and keys ─────────────────────────

/** scriptPubKey for a transparent address (P2PKH or P2SH). */
export function scriptFor(address: string): Uint8Array {
  const kind = parseTransparent(address);
  if (!kind || kind.network !== "mainnet") throw new Error("Not a mainnet transparent address");
  const hash = b58c.decode(address).slice(2);
  return kind.kind === "p2pkh"
    ? concat([Uint8Array.of(0x76, 0xa9, 0x14), hash, Uint8Array.of(0x88, 0xac)])
    : concat([Uint8Array.of(0xa9, 0x14), hash, Uint8Array.of(0x87)]);
}

/** Private key bytes from a compressed mainnet WIF. */
export function wifToKey(wif: string): Uint8Array {
  const b = b58c.decode(wif.trim());
  if (b.length !== 34 || b[0] !== 0x80 || b[33] !== 0x01) {
    throw new Error("Expected a compressed mainnet WIF key");
  }
  return b.slice(1, 33);
}

/** Split a P2PKH scriptSig into its DER signature (with hash type) and public key. */
export function parseP2pkhScriptSig(s: Uint8Array): { sig: Uint8Array; pubkey: Uint8Array } {
  const r = new Reader(s);
  const sig = r.bytes(r.u8());
  const pubkey = r.bytes(r.u8());
  if (!r.done) throw new Error("Not a P2PKH scriptSig");
  return { sig, pubkey };
}

/** Check one input's P2PKH signature against its ZIP 244 digest. */
export function verifyInput(tx: TransparentTx, index: number, coins: Utxo[]): boolean {
  const input = tx.inputs[index];
  if (!input) return false;
  const { sig, pubkey } = parseP2pkhScriptSig(input.scriptSig);
  if (sig[sig.length - 1] !== SIGHASH_ALL) return false;
  return secp256k1.verify(sig.slice(0, -1), sighash(tx, index, coins), pubkey, {
    lowS: false,
    format: "der",
  });
}

// ───────────────────────── sweeping ─────────────────────────

/** ZIP 317 conventional fee for P2PKH inputs and one output. */
export function sweepFee(inputs: number, outputs = 1): bigint {
  return MARGINAL_FEE * BigInt(Math.max(GRACE_ACTIONS, inputs, outputs));
}

export interface SweepPlan {
  raw: string;
  txid: string;
  fee: bigint;
  amount: bigint;
}

/**
 * Spend every coin at a one-time refund address to `to`, minus the ZIP 317
 * fee. Signed locally; the key never leaves the caller.
 */
/** Branch ids whose networks still take v5 transactions: NU5, NU6, NU6.1. */
const V5_BRANCHES = new Set([0xc2d6d0b4, 0xc8e71055, 0x4dec4df0]);

/** The mainnet t-address a WIF key controls. */
export function addressFromWif(wif: string): string {
  return pubkeyToTransparent(secp256k1.getPublicKey(wifToKey(wif), true), "mainnet");
}

export function buildSweep(p: {
  coins: Utxo[];
  wif: string;
  to: string;
  branchId: number;
  /** Current chain height; the transaction expires 40 blocks later (ZIP 203 default). */
  height: number;
  version?: typeof TX_V5 | typeof TX_V6;
}): SweepPlan {
  if (p.coins.length === 0) throw new Error("Nothing to sweep: this address has no coins");
  const key = wifToKey(p.wif);
  const pubkey = secp256k1.getPublicKey(key, true);
  const own = hex.to(scriptFor(pubkeyToTransparent(pubkey, "mainnet")));
  if (p.coins.some((c) => hex.to(c.script) !== own)) {
    throw new Error("Some coins are not locked to this key; refusing to sign");
  }
  const total = p.coins.reduce((n, c) => n + c.value, 0n);
  const fee = sweepFee(p.coins.length);
  const amount = total - fee;
  if (amount <= 0n)
    throw new Error(`The refund (${total} zat) does not cover the network fee (${fee} zat)`);
  const v = p.version ?? (V5_BRANCHES.has(p.branchId) ? TX_V5 : TX_V6);
  const tx: TransparentTx = {
    version: v.version,
    versionGroupId: v.versionGroupId,
    branchId: p.branchId,
    lockTime: 0,
    expiryHeight: p.height + 40,
    inputs: p.coins.map((c) => ({
      txid: c.txid,
      index: c.index,
      scriptSig: new Uint8Array(),
      sequence: 0xffffffff,
    })),
    outputs: [{ value: amount, script: scriptFor(p.to) }],
  };
  tx.inputs.forEach((input, i) => {
    const digest = sighash(tx, i, p.coins);
    // RFC 6979 deterministic nonce, low-S as Zcash relay policy requires.
    const der = secp256k1.sign(digest, key, { lowS: true }).toBytes("der");
    const full = concat([der, Uint8Array.of(SIGHASH_ALL)]);
    input.scriptSig = concat([
      Uint8Array.of(full.length),
      full,
      Uint8Array.of(pubkey.length),
      pubkey,
    ]);
  });
  if (!tx.inputs.every((_, i) => verifyInput(tx, i, p.coins))) {
    throw new Error("A signature failed its own check; nothing was sent");
  }
  return { raw: hex.to(encodeTx(tx)), txid: txid(tx), fee, amount };
}
