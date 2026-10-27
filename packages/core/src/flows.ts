import type { Flow } from "./types.ts";

/**
 * The subset of a NEAR Intents Explorer API transaction that Crowdline reads.
 * Field names match GET /api/v0/transactions.
 */
export interface ExplorerRow {
  originAsset: string;
  destinationAsset: string;
  recipient: string;
  refundTo: string;
  status: string;
  createdAtTimestamp: number;
  amountInFormatted: string;
  amountInUsd: string;
  amountOutUsd: string;
  /** Used as the pagination cursor. */
  depositAddress?: string;
  depositMemo?: string | null;
}

/**
 * Turn Explorer rows into flows. Swaps still in flight report amounts of 0
 * (the Explorer hides them on purpose), so they are dropped: an observer
 * cannot use them either.
 */
export function flowsFromExplorer(rows: ExplorerRow[]): Flow[] {
  const flows: Flow[] = [];
  for (const row of rows) {
    const amountInUsd = Number(row.amountInUsd);
    const amountOutUsd = Number(row.amountOutUsd);
    if (!(amountInUsd > 0) || !(amountOutUsd > 0)) continue;
    flows.push({
      t: row.createdAtTimestamp,
      originAsset: row.originAsset,
      destinationAsset: row.destinationAsset,
      amountInUsd,
      amountOutUsd,
      amountIn: Number(row.amountInFormatted),
      recipient: row.recipient,
      refundTo: row.refundTo,
      status: row.status,
    });
  }
  return flows;
}

/** Remove duplicate swaps when the same swap arrives from two queries. */
export function dedupeFlows(flows: Flow[]): Flow[] {
  const seen = new Set<string>();
  return flows.filter((f) => {
    const key = `${f.t}|${f.originAsset}|${f.destinationAsset}|${f.amountInUsd}|${f.recipient}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
