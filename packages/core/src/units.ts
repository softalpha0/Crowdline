/** ZEC has 8 decimal places; 1 ZEC = 100,000,000 zatoshi. */
export const ZEC_DECIMALS = 8;
const ZATS_PER_ZEC = 100_000_000n;

/**
 * Parse a decimal ZEC amount into zatoshi without going through floating point.
 * Accepts strings like "3", "3.417", "0.00000001", or a finite number.
 */
export function parseZec(input: string | number): bigint {
  const text = typeof input === "number" ? numberToPlain(input) : input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Not a ZEC amount: ${String(input)}`);
  }
  const [whole = "0", frac = ""] = text.split(".");
  if (frac.length > ZEC_DECIMALS) {
    throw new Error(`ZEC has at most ${ZEC_DECIMALS} decimals: ${text}`);
  }
  return BigInt(whole) * ZATS_PER_ZEC + BigInt(frac.padEnd(ZEC_DECIMALS, "0"));
}

/** Format zatoshi as a ZEC decimal with no trailing zeros ("3.417", "5"). */
export function formatZec(zats: bigint): string {
  if (zats < 0n) throw new Error("Negative amount");
  const whole = zats / ZATS_PER_ZEC;
  const frac = (zats % ZATS_PER_ZEC).toString().padStart(ZEC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Zatoshi to a JS number of ZEC. Only for display and scoring, never for payment. */
export function zatsToNumber(zats: bigint): number {
  return Number(zats) / 1e8;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`Not a ZEC amount: ${n}`);
  // toFixed(8) avoids exponent notation and rounds to the zatoshi.
  return n.toFixed(ZEC_DECIMALS).replace(/\.?0+$/, "") || "0";
}

/** Parse a decimal amount of a token with `decimals` places into its smallest unit. */
export function parseUnits(input: string, decimals: number): bigint {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Not an amount: ${input}`);
  const [whole = "0", frac = ""] = text.split(".");
  if (frac.length > decimals) throw new Error(`This token has at most ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
