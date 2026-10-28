import type {
  BacktestReport,
  Bucket,
  Report,
  RouteCrowd,
  SwapIntent,
  SwapStats,
  TimingReport,
} from "@crowdline/core";

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

export interface Timing extends TimingReport {
  mode: "live" | "demo";
}

export interface Routes {
  mode: "live" | "demo";
  routes: RouteCrowd[];
}

export interface Backtest extends Omit<BacktestReport, "buckets"> {
  mode: "live" | "demo";
  generatedAt: string;
  destinations: string[];
  /** toK is null for the open-ended top bucket (JSON has no Infinity). */
  buckets: (Omit<BacktestReport["buckets"][number], "toK"> & { toK: number | null })[];
}

export interface RefundCoins {
  height: number;
  branchId: number;
  coins: { txid: string; index: number; value: string; script: string }[];
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
  inboundQuote: (body: unknown) =>
    call<QuoteResult>("/api/inbound/quote", { method: "POST", body: JSON.stringify(body) }),
  timing: (destinationAsset: string, usd: number) =>
    call<Timing>(`/api/timing?destinationAsset=${encodeURIComponent(destinationAsset)}&usd=${usd}`),
  routes: (usd: number, destinationAsset: string) =>
    call<Routes>(`/api/routes?usd=${usd}&destinationAsset=${encodeURIComponent(destinationAsset)}`),
  backtest: () => call<Backtest>("/api/backtest"),
  refundCoins: (address: string) =>
    call<RefundCoins>(`/api/refund/coins?address=${encodeURIComponent(address)}`),
  broadcast: (raw: string) =>
    call<{ txid: string }>("/api/refund/broadcast", {
      method: "POST",
      body: JSON.stringify({ raw }),
    }),
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
