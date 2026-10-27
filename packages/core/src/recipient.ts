const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const EVM = new Set(["eth", "base", "arb", "bsc", "pol", "op", "avax", "gnosis", "bera"]);

/**
 * Cheap shape check for a payout address, so an obvious mistake is caught
 * before 1Click answers it with a bare 500. Returns a message, or null when
 * the address looks right or the chain is one Crowdline does not check.
 */
export function checkRecipient(blockchain: string, address: string): string | null {
  const a = address.trim();
  if (!a) return "Enter the address that should receive the payout.";
  const ok = (() => {
    if (blockchain === "sol") return BASE58.test(a) && a.length >= 32 && a.length <= 44;
    if (EVM.has(blockchain)) return /^0x[0-9a-fA-F]{40}$/.test(a);
    if (blockchain === "tron") return /^T/.test(a) && BASE58.test(a) && a.length === 34;
    if (blockchain === "btc")
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    if (blockchain === "near") return /^([a-z0-9_-]+\.)*[a-z0-9_-]+\.near$|^[0-9a-f]{64}$/.test(a);
    return true;
  })();
  return ok ? null : `That does not look like a ${blockchain} address.`;
}
