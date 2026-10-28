import { describe, expect, it } from "vitest";
import { cacheFromEnv, explorerGate, memoryCache, upstashCache } from "../src/cache.ts";

describe("shared cache", () => {
  it("expires values and claims in memory", async () => {
    let now = 0;
    const c = memoryCache(() => now);
    await c.set("a", { n: 1 }, 1000);
    expect(await c.get("a")).toEqual({ n: 1 });
    expect(await c.claim("turn", 500)).toBe(true);
    expect(await c.claim("turn", 500)).toBe(false);
    now = 1001;
    expect(await c.get("a")).toBeUndefined();
    expect(await c.claim("turn", 500)).toBe(true);
  });

  it("speaks Upstash REST without the network", async () => {
    const sent: unknown[] = [];
    const store = new Map<string, string>();
    const f = (async (_url: string, init?: RequestInit) => {
      const args = JSON.parse(init?.body as string) as string[];
      sent.push(args);
      const [cmd, key = "", value = ""] = args;
      if (cmd === "GET") return Response.json({ result: store.get(key) ?? null });
      if (args.includes("NX") && store.has(key)) return Response.json({ result: null });
      store.set(key, value);
      return Response.json({ result: "OK" });
    }) as unknown as typeof fetch;
    const c = upstashCache({ url: "https://kv.test", token: "t", fetch: f });
    await c.set("flows", [1, 2], 2000);
    expect(await c.get("flows")).toEqual([1, 2]);
    expect(await c.claim("turn", 5100)).toBe(true);
    expect(await c.claim("turn", 5100)).toBe(false);
    expect(sent[0]).toEqual(["SET", "crowdline:flows", "[1,2]", "PX", 2000]);
  });

  it("is shared only when configured", () => {
    expect(cacheFromEnv({}).shared).toBe(false);
    expect(cacheFromEnv({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" }).shared).toBe(
      true,
    );
  });

  it("waits for the Explorer turn, and gives up rather than hang", async () => {
    let now = 0;
    const c = memoryCache(() => now);
    const slept: number[] = [];
    const gate = explorerGate(c, {
      maxWaitMs: 2000,
      sleep: (ms) => {
        slept.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await gate();
    expect(slept).toHaveLength(0);
    await gate();
    expect(slept).toHaveLength(4); // held for 5.1s, gave up after 2s
  });
});
