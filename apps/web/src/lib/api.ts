import type { Bucket, Report, SwapIntent, SwapStats } from "@crowdline/core";

export interface Destination {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
}

export interface Config {
  mode: "live" | "demo";
  tokensAreDemo: boolean;
  /** False when the server cannot ask 1Click for confidential quotes. */
  quotes: boolean;
  lookbackHours: number;
  zec?: { assetId: string; price: number };
  destinations: Destination[];
}

export interface AuditResult {
  mode: "live" | "demo";
  flowsChecked: number;
  before: Report;
  buckets: Bucket[];
  after: Report;
  hardened: SwapIntent;
}

export interface QuoteResult {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: Record<string, unknown>;
  quote: {
    depositAddress?: string;
    amountInFormatted: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    deadline?: string;
    timeEstimate?: number;
    [k: string]: unknown;
  };
}

export interface TxRef {
  hash: string;
  explorerUrl: string;
}

export interface StatusResult {
  status: string;
  updatedAt: string;
  swapDetails: {
    originChainTxHashes: TxRef[];
    destinationChainTxHashes: TxRef[];
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
  };
}

export interface Stats extends SwapStats {
  mode: "live" | "demo";
  generatedAt: string;
  pages: number;
  truncated: boolean;
  zecUsd: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Could not reach the Crowdline server. Check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  config: () => call<Config>("/api/config"),
  stats: () => call<Stats>("/api/stats"),
  audit: (body: unknown) =>
    call<AuditResult>("/api/audit", { method: "POST", body: JSON.stringify(body) }),
  quote: (body: unknown) =>
    call<QuoteResult>("/api/quote", { method: "POST", body: JSON.stringify(body) }),
  status: (depositAddress: string) =>
    call<StatusResult>(`/api/status?depositAddress=${encodeURIComponent(depositAddress)}`),
};

export const TERMINAL = ["SUCCESS", "REFUNDED", "FAILED"];

/** The message of anything thrown, for showing to the user. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The confidentiality a quote was requested with. 1Click does not sign this field. */
export function confidentialityOf(q: QuoteResult): string {
  const c = q.quoteRequest.confidentiality;
  return typeof c === "string" ? c : "public";
}
