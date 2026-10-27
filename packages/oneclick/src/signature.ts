import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { base58 } from "@scure/base";

/**
 * 1Click's quote-signing key, from the official TypeScript SDK
 * (@defuse-protocol/one-click-sdk-typescript, ONE_CLICK_MANAGER_PUB_KEY).
 */
export const ONECLICK_PUBLIC_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** The parts of a quote response that verification reads. Extra fields are ignored. */
export interface SignedQuote {
  signature: string;
  timestamp: string;
  quoteRequest: Record<string, unknown>;
  quote: Record<string, unknown>;
}

// Request fields 1Click signs, in the SDK's order. Anything else in the
// request (confidentiality, appFees, depositMode, ...) is NOT covered.
const SIGNED_REQUEST = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
] as const;
// Signed only when truthy.
const SIGNED_REQUEST_OPTIONAL = [
  "quoteWaitingTimeMs",
  "referral",
  "virtualChainRecipient",
  "virtualChainRefundRecipient",
  "customRecipientMsg",
] as const;

const SIGNED_QUOTE = [
  "amountIn",
  "amountInFormatted",
  "amountInUsd",
  "minAmountIn",
  "amountOut",
  "amountOutFormatted",
  "amountOutUsd",
  "minAmountOut",
] as const;
// Only on non-dry quotes, and only when truthy.
const SIGNED_QUOTE_EXECUTION = [
  "depositAddress",
  "depositMemo",
  "deadline",
  "timeWhenInactive",
  "timeEstimate",
  "refundFee",
  "withdrawFee",
] as const;

/** Request fields a valid signature does not vouch for. Shown next to the check. */
export const UNSIGNED_REQUEST_FIELDS = ["confidentiality", "appFees", "depositMode"] as const;

/** Deterministic JSON with sorted keys, matching json-stable-stringify for plain data. */
export function stableStringify(value: unknown): string {
  // Callers drop undefined before recursing, so primitives always serialise.
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

function pick(
  src: Record<string, unknown>,
  always: readonly string[],
  ifTruthy: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of always) out[k] = src[k];
  for (const k of ifTruthy) if (src[k]) out[k] = src[k];
  return out;
}

/** The base58 SHA-256 message 1Click signs for a quote. */
export function quoteMessage(q: SignedQuote): string {
  const dry = q.quoteRequest.dry === true;
  const request = pick(q.quoteRequest, SIGNED_REQUEST, SIGNED_REQUEST_OPTIONAL);
  const quote = pick(q.quote, SIGNED_QUOTE, dry ? [] : SIGNED_QUOTE_EXECUTION);
  const text = stableStringify({ ...request, ...quote, timestamp: q.timestamp });
  return base58.encode(sha256(new TextEncoder().encode(text)));
}

function decodeKey(value: string): Uint8Array {
  return base58.decode(value.startsWith("ed25519:") ? value.slice(8) : value);
}

/**
 * Check that a quote (or the quoteResponse inside a status) was signed by
 * 1Click and has not been changed since. Never throws.
 */
export function verifyQuoteSignature(q: unknown, publicKey = ONECLICK_PUBLIC_KEY): boolean {
  try {
    const s = q as Partial<SignedQuote> | null;
    if (!s || typeof s.signature !== "string" || typeof s.timestamp !== "string") return false;
    if (!s.quoteRequest || !s.quote) return false;
    const message = new TextEncoder().encode(quoteMessage(s as SignedQuote));
    return ed25519.verify(decodeKey(s.signature), message, decodeKey(publicKey));
  } catch {
    return false;
  }
}
