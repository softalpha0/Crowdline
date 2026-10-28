import type {
  Bucket,
  Confidentiality,
  Flow,
  FundingSource,
  RefundMode,
  Report,
  ShieldedAge,
  SwapIntent,
} from "@crowdline/core";
import { auditIntent, suggestBuckets } from "@crowdline/core";

export interface AuditRequest {
  amountZec: string;
  destinationAsset: string;
  recipient: string;
  confidentiality: Confidentiality;
  funding: FundingSource;
  /** For shielded funding: how long ago the funds entered the shielded pool. */
  shieldedAge: ShieldedAge;
  refund: RefundMode;
  /** The refund address the user would otherwise use. Checked against history only. */
  refundTo?: string;
  maxHoldBack?: number;
}

export interface AuditResponse {
  before: Report;
  buckets: Bucket[];
  after: Report;
  /** The intent Crowdline recommends sending. */
  hardened: SwapIntent;
}

const CONF = ["public", "basic", "advanced"] as const;
const FUND = ["shielded", "transparent-fresh", "transparent-reused"] as const;
const REFUND = ["reused", "one-time"] as const;
const AGE = ["unknown", "over-day", "hours", "under-hour"] as const;

/** A request field as text: strings and numbers pass, anything else is empty. */
export function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of ${allowed.join(", ")}`);
}

export function parseAuditRequest(body: unknown): AuditRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const amountZec = text(b.amountZec).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(amountZec) || Number(amountZec) <= 0) {
    throw new Error("amountZec must be a positive ZEC amount with at most 8 decimals");
  }
  const destinationAsset = text(b.destinationAsset).trim();
  if (!destinationAsset) throw new Error("destinationAsset is required");
  const maxHoldBack = b.maxHoldBack === undefined ? undefined : Number(b.maxHoldBack);
  if (maxHoldBack !== undefined && !(maxHoldBack >= 0 && maxHoldBack <= 0.5)) {
    throw new Error("maxHoldBack must be between 0 and 0.5");
  }
  return {
    amountZec,
    destinationAsset,
    recipient: text(b.recipient).trim(),
    confidentiality: oneOf(b.confidentiality ?? "public", CONF, "confidentiality"),
    funding: oneOf(b.funding ?? "shielded", FUND, "funding"),
    shieldedAge: oneOf(b.shieldedAge ?? "unknown", AGE, "shieldedAge"),
    refund: oneOf(b.refund ?? "reused", REFUND, "refund"),
    refundTo: typeof b.refundTo === "string" && b.refundTo.trim() ? b.refundTo.trim() : undefined,
    maxHoldBack,
  };
}

/**
 * Audit the swap as the user described it, then the hardened version:
 * crowded amount, Confidential Intents, a one-time refund address and a
 * deposit paid straight from the shielded pool. The recipient is the user's
 * call and is left alone.
 */
export function runAudit(
  req: AuditRequest,
  ctx: { flows: Flow[]; zecAsset: string; zecUsd: number },
): AuditResponse {
  const intent: SwapIntent = {
    amountZec: Number(req.amountZec),
    zecUsd: ctx.zecUsd,
    destinationAsset: req.destinationAsset,
    recipient: req.recipient,
    confidentiality: req.confidentiality,
    funding: req.funding,
    ...(req.funding === "shielded" ? { shieldedAge: req.shieldedAge } : {}),
    refund: req.refund,
  };
  const before = auditIntent(intent, {
    flows: ctx.flows,
    zecAsset: ctx.zecAsset,
    refundTo: req.refundTo,
  });

  const buckets = suggestBuckets(
    ctx.flows,
    {
      amountZec: req.amountZec,
      zecUsd: ctx.zecUsd,
      zecAsset: ctx.zecAsset,
      destinationAsset: req.destinationAsset,
    },
    req.maxHoldBack === undefined ? {} : { maxHoldBack: req.maxHoldBack },
  );
  const best = buckets[0];

  const hardened: SwapIntent = {
    ...intent,
    amountZec: best ? Number(best.amountZec) : intent.amountZec,
    confidentiality: intent.confidentiality === "public" ? "basic" : intent.confidentiality,
    funding: "shielded",
    // Funds shielded only now, to make this swap, have barely sat in the pool.
    shieldedAge: intent.funding === "shielded" ? req.shieldedAge : "under-hour",
    refund: "one-time",
  };
  const after = auditIntent(hardened, { flows: ctx.flows, zecAsset: ctx.zecAsset });

  return { before, buckets, after, hardened };
}
