import type { Crowd, Finding } from "./types.ts";

export const RECEIPT_VERSION = 1;

export interface ReceiptInput {
  crowdData: "live" | "demo";
  before?: { score: number; crowd: Crowd; findings: Finding[] };
  after?: { score: number; crowd: Crowd };
  chosenAmountZec?: string;
  /** Only `address` and `path` are read; the phrase and WIF are never copied. */
  refund?: { address: string; path: string };
  quote?: unknown;
  status?: unknown;
  signatureValid?: boolean;
  now?: Date;
}

export interface Receipt {
  app: "crowdline";
  version: number;
  createdAt: string;
  crowdData: "live" | "demo";
  before?: { score: number; crowd: Crowd; findings: Finding[] };
  after?: { score: number; crowd: Crowd };
  chosenAmountZec?: string;
  refundAddress?: string;
  refundPath?: string;
  /** The 1Click quote response exactly as received, signature included. */
  quote?: unknown;
  signatureValid?: boolean;
  status?: unknown;
}

/**
 * Build the downloadable receipt. Fields are copied one by one from an
 * allow-list, so a refund key passed in by mistake cannot end up in the file.
 */
export function buildReceipt(i: ReceiptInput): Receipt {
  return {
    app: "crowdline",
    version: RECEIPT_VERSION,
    createdAt: (i.now ?? new Date()).toISOString(),
    crowdData: i.crowdData,
    before: i.before && {
      score: i.before.score,
      crowd: i.before.crowd,
      findings: i.before.findings,
    },
    after: i.after && { score: i.after.score, crowd: i.after.crowd },
    chosenAmountZec: i.chosenAmountZec,
    refundAddress: i.refund?.address,
    refundPath: i.refund?.path,
    quote: i.quote,
    signatureValid: i.signatureValid,
    status: i.status,
  };
}

/** Read a receipt file back. Throws on anything that is not a Crowdline receipt. */
export function parseReceipt(text: string): Receipt {
  const r = JSON.parse(text) as Partial<Receipt>;
  if (r.app !== "crowdline") throw new Error("Not a Crowdline receipt");
  if (r.crowdData !== "live" && r.crowdData !== "demo")
    throw new Error("Receipt has no crowd data mode");
  return r as Receipt;
}
