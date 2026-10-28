import { Client, credentials, Metadata } from "@grpc/grpc-js";
import type { ztx } from "@crowdline/core";

type Utxo = ztx.Utxo;

/**
 * Minimal lightwalletd (ZIP 307 CompactTxStreamer) client: enough to find the
 * coins at a one-time refund address and broadcast the sweep the browser signed.
 * The few protobuf messages involved are encoded by hand so no .proto files
 * have to ship with the serverless bundle.
 */

export interface ChainInfo {
  chainName: string;
  /** Consensus branch id of the current network upgrade, e.g. 0x37a5165b (NU6.3). */
  branchId: number;
  height: number;
}

export interface Lightwalletd {
  info(): Promise<ChainInfo>;
  utxos(address: string): Promise<Utxo[]>;
  send(raw: Uint8Array): Promise<{ errorCode: number; errorMessage: string }>;
}

// ───────────────────────── protobuf, the small part we need ─────────────────────────

function varint(n: bigint): number[] {
  const out: number[] = [];
  let v = n;
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}

const key = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
function lenField(field: number, bytes: Uint8Array): number[] {
  return [...key(field, 2), ...varint(BigInt(bytes.length)), ...bytes];
}
const uintField = (field: number, n: bigint) => [...key(field, 0), ...varint(n)];

type Fields = Map<number, (bigint | Uint8Array)[]>;

export function decodeMessage(buf: Uint8Array): Fields {
  const fields: Fields = new Map();
  let i = 0;
  const readVarint = () => {
    let shift = 0n;
    let out = 0n;
    for (;;) {
      const b = buf[i++];
      if (b === undefined) throw new Error("Truncated protobuf");
      out |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return out;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const k = Number(readVarint());
    const field = k >> 3;
    const wire = k & 7;
    let v: bigint | Uint8Array;
    if (wire === 0) v = readVarint();
    else if (wire === 2) {
      const len = Number(readVarint());
      v = buf.slice(i, i + len);
      i += len;
    } else if (wire === 1) {
      v = new DataView(buf.buffer, buf.byteOffset + i, 8).getBigUint64(0, true);
      i += 8;
    } else if (wire === 5) {
      v = BigInt(new DataView(buf.buffer, buf.byteOffset + i, 4).getUint32(0, true));
      i += 4;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
    fields.set(field, [...(fields.get(field) ?? []), v]);
  }
  return fields;
}

const text = (v: bigint | Uint8Array | undefined) =>
  v instanceof Uint8Array ? new TextDecoder().decode(v) : "";
const num = (v: bigint | Uint8Array | undefined) => (typeof v === "bigint" ? v : 0n);
const bytes = (v: bigint | Uint8Array | undefined) =>
  v instanceof Uint8Array ? v : new Uint8Array();
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const codec = {
  addressUtxosArg: (address: string) =>
    Uint8Array.from([
      ...lenField(1, new TextEncoder().encode(address)),
      ...uintField(2, 0n),
      ...uintField(3, 1000n),
    ]),
  rawTransaction: (raw: Uint8Array) => Uint8Array.from(lenField(1, raw)),
  lightdInfo(buf: Uint8Array): ChainInfo {
    const f = decodeMessage(buf);
    return {
      chainName: text(f.get(4)?.[0]),
      branchId: parseInt(text(f.get(6)?.[0]) || "0", 16),
      height: Number(num(f.get(7)?.[0])),
    };
  },
  utxoList(buf: Uint8Array): Utxo[] {
    return (decodeMessage(buf).get(1) ?? []).map((entry) => {
      const u = decodeMessage(bytes(entry));
      // lightwalletd returns txids in internal byte order; reverse for display.
      return {
        txid: toHex(Uint8Array.from(bytes(u.get(1)?.[0])).reverse()),
        index: Number(num(u.get(2)?.[0])),
        script: bytes(u.get(3)?.[0]),
        value: BigInt.asIntN(64, num(u.get(4)?.[0])),
      };
    });
  },
  sendResponse(buf: Uint8Array) {
    const f = decodeMessage(buf);
    return {
      errorCode: Number(BigInt.asIntN(32, num(f.get(1)?.[0]))),
      errorMessage: text(f.get(2)?.[0]),
    };
  },
};

// ───────────────────────── client ─────────────────────────

const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer";

export function lightwalletd(
  host = process.env.LIGHTWALLETD_HOST ?? "zec.rocks:443",
): Lightwalletd {
  let client: Client | undefined;
  const call = <T>(method: string, arg: Uint8Array, decode: (b: Uint8Array) => T): Promise<T> =>
    new Promise((resolve, reject) => {
      client ??= new Client(host, credentials.createSsl());
      client.makeUnaryRequest(
        `${SERVICE}/${method}`,
        (x: Uint8Array) => Buffer.from(x),
        (b: Buffer) => decode(new Uint8Array(b)),
        arg,
        new Metadata(),
        { deadline: Date.now() + 20_000 },
        (err, res) => {
          if (err || res === undefined) reject(err ?? new Error("No reply"));
          else resolve(res);
        },
      );
    });
  return {
    info: () => call("GetLightdInfo", new Uint8Array(), (b) => codec.lightdInfo(b)),
    utxos: (address) =>
      call("GetAddressUtxos", codec.addressUtxosArg(address), (b) => codec.utxoList(b)),
    send: (raw) => call("SendTransaction", codec.rawTransaction(raw), (b) => codec.sendResponse(b)),
  };
}
