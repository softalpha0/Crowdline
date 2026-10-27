export function short(s: string, head = 8, tail = 6): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function usd(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function crowdLabel(k: number): string {
  return `${Math.max(1, Math.round(k))}`;
}

export function scoreTone(score: number): "bad" | "warn" | "good" {
  return score >= 55 ? "good" : score >= 30 ? "warn" : "bad";
}

/** $23.9M style, for headline numbers that must fit a phone column. */
export function usdCompact(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
