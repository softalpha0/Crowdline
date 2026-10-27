import { describe, expect, it } from "vitest";
import { formatZec, parseZec } from "../src/units.ts";

describe("ZEC units", () => {
  it("parses decimals without float error", () => {
    expect(parseZec("3.417")).toBe(341_700_000n);
    expect(parseZec("0.00000001")).toBe(1n);
    expect(parseZec("0.1")).toBe(10_000_000n);
    expect(parseZec(0.1 + 0.2)).toBe(30_000_000n);
  });

  it("rejects bad input", () => {
    expect(() => parseZec("1.000000001")).toThrow();
    expect(() => parseZec("-1")).toThrow();
    expect(() => parseZec("1e3")).toThrow();
    expect(() => parseZec("")).toThrow();
  });

  it("formats without trailing zeros and round-trips", () => {
    expect(formatZec(500_000_000n)).toBe("5");
    expect(formatZec(341_700_000n)).toBe("3.417");
    expect(formatZec(1n)).toBe("0.00000001");
    for (const s of ["0.5", "12.34567891", "100"]) expect(formatZec(parseZec(s))).toBe(s);
  });
});
