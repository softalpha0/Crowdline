/** Types from https://1click.chaindefuser.com/docs/v0/openapi.yaml (v0.1.10). */

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
export type DepositType = "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
export type RecipientType = "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
export type RefundType = "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

export interface QuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: DepositType;
  destinationAsset: string;
  /** Integer string in the origin asset's smallest unit. */
  amount: string;
  refundTo: string;
  refundType: RefundType;
  recipient: string;
  recipientType: RecipientType;
  /** ISO timestamp after which refunds start. */
  deadline: string;
  confidentiality?: "public" | "basic" | "advanced";
  depositMode?: "SIMPLE" | "MEMO";
  referral?: string;
  quoteWaitingTimeMs?: number;
  sessionId?: string;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  /** 1Click's signature over the quote. Keep it: it settles disputes. */
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface TxRef {
  hash: string;
  explorerUrl: string;
}

export interface StatusResponse {
  correlationId: string;
  quoteResponse: QuoteResponse;
  status: SwapStatus;
  updatedAt: string;
  swapDetails: {
    intentHashes: string[];
    nearTxHashes: string[];
    originChainTxHashes: TxRef[];
    destinationChainTxHashes: TxRef[];
    amountInFormatted?: string;
    amountOutFormatted?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
    depositedAmountFormatted?: string;
  };
}
