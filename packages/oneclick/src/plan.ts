import { parseTransparent, parseUnits, parseZec } from "@crowdline/core";
import type { QuoteRequest } from "./types.ts";

export interface PlanInput {
  zecAsset: string;
  destinationAsset: string;
  /** ZEC to send, as a decimal string. */
  amountZec: string;
  recipient: string;
  /** Transparent address for refunds. Crowdline passes a one-time address here. */
  refundTo: string;
  confidentiality: "public" | "basic" | "advanced";
  slippageBps?: number;
  /** How long the deposit address stays usable. Zcash blocks are ~75s. */
  deadlineMinutes?: number;
  dry?: boolean;
  now?: Date;
}

/**
 * Turn an audited plan into a 1Click quote request.
 *
 * EXACT_INPUT is deliberate: the user sends exactly the bucket amount, so
 * there is no excess to refund on success, and the only refund path is a
 * failed swap.
 */
export function buildQuoteRequest(p: PlanInput): QuoteRequest {
  if (!parseTransparent(p.refundTo)) {
    throw new Error("1Click refunds ZEC to transparent addresses only (t1/t3)");
  }
  if (!p.recipient.trim()) throw new Error("Recipient is required");
  const zats = parseZec(p.amountZec);
  if (zats <= 0n) throw new Error("Amount must be positive");
  const now = p.now ?? new Date();
  const deadline = new Date(now.getTime() + (p.deadlineMinutes ?? 120) * 60_000);

  return {
    dry: p.dry ?? false,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps ?? 100,
    originAsset: p.zecAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset,
    amount: zats.toString(),
    refundTo: p.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient.trim(),
    recipientType: "DESTINATION_CHAIN",
    deadline: deadline.toISOString(),
    confidentiality: p.confidentiality,
    referral: "crowdline",
  };
}

export interface InboundInput {
  /** The asset being sent in, e.g. USDC on Solana. */
  originAsset: string;
  originDecimals: number;
  zecAsset: string;
  /** Amount of the origin asset, as a decimal string. */
  amount: string;
  /** Zcash transparent address that receives the ZEC. Shield it on arrival. */
  recipient: string;
  /** Address on the origin chain for refunds: the wallet the user pays from. */
  refundTo: string;
  confidentiality: "public" | "basic" | "advanced";
  slippageBps?: number;
  deadlineMinutes?: number;
  dry?: boolean;
  now?: Date;
}

/**
 * The way in: another chain's asset to ZEC. 1Click pays ZEC to transparent
 * addresses only, so the recipient is a t-address the user shields from.
 */
export function buildInboundQuoteRequest(p: InboundInput): QuoteRequest {
  if (!parseTransparent(p.recipient)) {
    throw new Error(
      "1Click pays ZEC to transparent addresses only (t1/t3). Use your wallet's transparent receive address.",
    );
  }
  if (!p.refundTo.trim()) throw new Error("Refund address is required");
  const amount = parseUnits(p.amount, p.originDecimals);
  if (amount <= 0n) throw new Error("Amount must be positive");
  const now = p.now ?? new Date();
  const deadline = new Date(now.getTime() + (p.deadlineMinutes ?? 60) * 60_000);
  return {
    dry: p.dry ?? false,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps ?? 100,
    originAsset: p.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.zecAsset,
    amount: amount.toString(),
    refundTo: p.refundTo.trim(),
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient.trim(),
    recipientType: "DESTINATION_CHAIN",
    deadline: deadline.toISOString(),
    confidentiality: p.confidentiality,
    referral: "crowdline",
  };
}
