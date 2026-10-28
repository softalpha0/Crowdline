import { refundFromMnemonic } from "@crowdline/core";
import { describe, expect, it } from "vitest";
import { Explorer, OneClick, findZec } from "../src/client.ts";
import { buildInboundQuoteRequest, buildQuoteRequest } from "../src/plan.ts";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const REFUND = refundFromMnemonic(PHRASE).address;
const NOW = new Date("2026-10-27T12:00:00Z");

describe("buildQuoteRequest", () => {
  const base = {
    zecAsset: "nep141:zec.omft.near",
    destinationAsset: "nep141:usdc.test",
    amountZec: "3",
    recipient: "  SoLRecipient111  ",
    refundTo: REFUND,
    confidentiality: "basic" as const,
    now: NOW,
  };

  it("builds a confidential exact-input request in zatoshi", () => {
    expect(buildQuoteRequest(base)).toEqual({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: "nep141:zec.omft.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:usdc.test",
      amount: "300000000",
      refundTo: REFUND,
      refundType: "ORIGIN_CHAIN",
      recipient: "SoLRecipient111",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-10-27T14:00:00.000Z",
      confidentiality: "basic",
      referral: "crowdline",
    });
  });

  it("refuses refunds to anything but a transparent address", () => {
    expect(() => buildQuoteRequest({ ...base, refundTo: "u1shielded" })).toThrow(/transparent/);
  });

  it("refuses an empty recipient or zero amount", () => {
    expect(() => buildQuoteRequest({ ...base, recipient: " " })).toThrow();
    expect(() => buildQuoteRequest({ ...base, amountZec: "0" })).toThrow();
  });
});

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; init?: RequestInit; at: number }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init, at: Date.now() });
    return new Response(JSON.stringify(handler(url, init)), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("OneClick client", () => {
  it("sends the API key header and the quote body", async () => {
    const { f, calls } = fakeFetch(() => ({ ok: true }));
    const c = new OneClick({ apiKey: "k", fetch: f });
    await c.quote(
      buildQuoteRequest({
        zecAsset: "z",
        destinationAsset: "d",
        amountZec: "1",
        recipient: "r",
        refundTo: REFUND,
        confidentiality: "basic",
      }),
    );
    expect(calls[0]?.url).toBe("https://1click.chaindefuser.com/v0/quote");
    expect((calls[0]?.init?.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    const sent = JSON.parse(calls[0]?.init?.body as string) as { confidentiality: string };
    expect(sent.confidentiality).toBe("basic");
  });

  it("surfaces HTTP errors with the response body", async () => {
    const f = (async () => new Response("bad amount", { status: 400 })) as unknown as typeof fetch;
    await expect(new OneClick({ fetch: f }).tokens()).rejects.toThrow(/400.*bad amount/);
  });

  it("finds ZEC on the zec chain", () => {
    const zec = findZec([
      { assetId: "a", decimals: 6, blockchain: "sol", symbol: "ZEC", price: 1 },
      { assetId: "b", decimals: 8, blockchain: "zec", symbol: "ZEC", price: 300 },
    ]);
    expect(zec.assetId).toBe("b");
    expect(() => findZec([])).toThrow();
  });
});

describe("Explorer client", () => {
  it("spaces requests to respect the 1-per-5s limit", async () => {
    const waits: number[] = [];
    const { f, calls } = fakeFetch(() => []);
    const ex = new Explorer({
      jwt: "j",
      fetch: f,
      minGapMs: 5000,
      sleep: async (ms) => void waits.push(ms),
    });
    await ex.crowdRows("nep141:usdc.test", 24, 1_800_000_000);
    expect(calls).toHaveLength(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(4000);
    expect(calls[0]?.url).toContain("fromChainId=zec");
    expect(calls[1]?.url).toContain("toTokenId=nep141%3Ausdc.test");
    expect(calls[0]?.url).toContain("startTimestampUnix=1799913600");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer j");
  });

  const row = (i: number, t: number) => ({
    originAsset: "z",
    destinationAsset: "d",
    recipient: "r",
    refundTo: "t",
    status: "SUCCESS",
    createdAtTimestamp: t,
    amountInFormatted: "1",
    amountInUsd: "300",
    amountOutUsd: "299",
    depositAddress: `t1deposit${i}`,
    depositMemo: null,
  });
  const fast = { jwt: "j", minGapMs: 0, sleep: async () => undefined };

  it("pages with the lastDepositAddress cursor until a short page", async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, i) => row(i, 2000 - i)),
      Array.from({ length: 10 }, (_, i) => row(1000 + i, 990 - i)),
    ];
    const { f, calls } = fakeFetch(() => pages[calls.length - 1] ?? []);
    const out = await new Explorer({ ...fast, fetch: f }).transactionsSince(
      { fromChainId: "zec" },
      500,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).not.toContain("lastDepositAddress");
    expect(calls[1]?.url).toContain("lastDepositAddress=t1deposit999");
    expect(calls[1]?.url).toContain("direction=next");
    expect(calls[1]?.url).toContain("numberOfTransactions=1000");
    expect(out).toMatchObject({ pages: 2, truncated: false });
    expect(out.rows).toHaveLength(1010);
  });

  it("stops once a page reaches the start of the window", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => row(i, 1500 - i));
    const { f, calls } = fakeFetch(() => page);
    const out = await new Explorer({ ...fast, fetch: f }).transactionsSince({}, 1000);
    expect(calls).toHaveLength(1);
    // Rows at or before `since` are dropped.
    expect(out.rows).toHaveLength(500);
    expect(out.truncated).toBe(false);
  });

  it("reports truncation when maxPages runs out", async () => {
    let n = 0;
    const { f, calls } = fakeFetch(() => Array.from({ length: 1000 }, () => row(n, 100_000 - n++)));
    const out = await new Explorer({ ...fast, fetch: f }).transactionsSince({}, 0, 3);
    expect(calls).toHaveLength(3);
    expect(out).toMatchObject({ pages: 3, truncated: true });
  });
});

describe("buildInboundQuoteRequest", () => {
  const base = {
    originAsset: "nep141:usdc.test",
    originDecimals: 6,
    zecAsset: "nep141:zec.omft.near",
    amount: "12.34",
    recipient: REFUND,
    refundTo: " SolWallet ",
    confidentiality: "basic" as const,
    now: NOW,
  };
  it("swaps into ZEC at a transparent address, in the origin token's units", () => {
    expect(buildInboundQuoteRequest(base)).toMatchObject({
      originAsset: "nep141:usdc.test",
      destinationAsset: "nep141:zec.omft.near",
      amount: "12340000",
      refundTo: "SolWallet",
      recipient: REFUND,
      swapType: "EXACT_INPUT",
      deadline: "2026-10-27T13:00:00.000Z",
    });
  });
  it("refuses shielded recipients and too many decimals", () => {
    expect(() => buildInboundQuoteRequest({ ...base, recipient: "u1xyz" })).toThrow(/transparent/);
    expect(() => buildInboundQuoteRequest({ ...base, amount: "1.0000001" })).toThrow(/decimals/);
    expect(() => buildInboundQuoteRequest({ ...base, amount: "0" })).toThrow(/positive/);
  });
});

describe("Explorer rate limit", () => {
  it("waits one turn and retries a 429 once", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return n === 1
        ? new Response('{"message":"Too Many Requests"}', { status: 429 })
        : Response.json([]);
    }) as unknown as typeof fetch;
    const ex = new Explorer({ jwt: "j", fetch: f, minGapMs: 0 });
    expect(await ex.transactions({ fromChainId: "zec" })).toEqual([]);
    expect(n).toBe(2);
  });
});
