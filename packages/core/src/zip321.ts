import { parseTransparent } from "./refund.ts";
import { formatZec } from "./units.ts";

/**
 * Build a ZIP-321 payment request for the 1Click deposit.
 *
 * 1Click only accepts Zcash deposits to transparent addresses, and ZIP-321
 * forbids a memo on transparent recipients, so the request carries just the
 * address and the exact amount. A shielded wallet (ZODL, Zingo, Zkool) pays
 * it straight from Orchard, so the input side stays private.
 */
export function depositRequest(address: string, amountZats: bigint): string {
  if (!parseTransparent(address)) {
    throw new Error("1Click Zcash deposit addresses are transparent (t1/t3)");
  }
  if (amountZats <= 0n) throw new Error("Amount must be positive");
  return `zcash:${address}?amount=${formatZec(amountZats)}`;
}
