import { ripemd160 } from "@noble/hashes/legacy";
import { sha256 } from "@noble/hashes/sha2";
import { createBase58check } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const b58c = createBase58check(sha256);

/** Two-byte version prefixes for Zcash transparent addresses. */
const PREFIX = {
  mainnet: { p2pkh: [0x1c, 0xb8], p2sh: [0x1c, 0xbd] },
  testnet: { p2pkh: [0x1d, 0x25], p2sh: [0x1c, 0xba] },
} as const;

export type Network = keyof typeof PREFIX;

/** BIP-44 path Zcash wallets use for transparent keys (coin type 133, testnet 1). */
export function refundPath(network: Network, index = 0): string {
  return `m/44'/${network === "mainnet" ? 133 : 1}'/0'/0/${index}`;
}

export interface OneTimeRefund {
  network: Network;
  /** 24 words. Restore in a wallet that scans transparent addresses to sweep a refund. */
  mnemonic: string;
  path: string;
  /** Transparent P2PKH address handed to 1Click as `refundTo`. */
  address: string;
  /** The same key as a compressed WIF, for wallets that import single keys. */
  wif: string;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function concat(...parts: (ArrayLike<number> | Uint8Array)[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** Encode a compressed secp256k1 public key as a Zcash transparent address. */
export function pubkeyToTransparent(pubkey: Uint8Array, network: Network = "mainnet"): string {
  if (pubkey.length !== 33) throw new Error("Expected a 33-byte compressed public key");
  return b58c.encode(concat(PREFIX[network].p2pkh, hash160(pubkey)));
}

/** Derive the refund address and key for a given recovery phrase. */
export function refundFromMnemonic(
  mnemonic: string,
  network: Network = "mainnet",
  index = 0,
): OneTimeRefund {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("Invalid recovery phrase");
  const path = refundPath(network, index);
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(path);
  if (!node.publicKey || !node.privateKey) throw new Error("Key derivation failed");
  const wifPrefix = network === "mainnet" ? 0x80 : 0xef;
  return {
    network,
    mnemonic,
    path,
    address: pubkeyToTransparent(node.publicKey, network),
    wif: b58c.encode(concat([wifPrefix], node.privateKey, [0x01])),
  };
}

/**
 * Make a fresh refund identity for one swap. Runs entirely on the user's
 * device: the phrase and key never go to Crowdline's server or to 1Click.
 */
export function newOneTimeRefund(network: Network = "mainnet"): OneTimeRefund {
  return refundFromMnemonic(generateMnemonic(wordlist, 256), network);
}

export type TransparentKind = "p2pkh" | "p2sh";

/** Check a Zcash transparent address and its checksum. Returns null if invalid. */
export function parseTransparent(
  address: string,
): { network: Network; kind: TransparentKind } | null {
  let bytes: Uint8Array;
  try {
    bytes = b58c.decode(address.trim());
  } catch {
    return null;
  }
  if (bytes.length !== 22) return null;
  for (const network of Object.keys(PREFIX) as Network[]) {
    for (const kind of ["p2pkh", "p2sh"] as const) {
      const [a, b] = PREFIX[network][kind];
      if (bytes[0] === a && bytes[1] === b) return { network, kind };
    }
  }
  return null;
}
