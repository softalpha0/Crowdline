/**
 * A cache every server instance can see. On Vercel each cold start is a fresh
 * process, so an in-memory cache alone means each one re-reads the Explorer
 * and they all compete for the same one-request-per-5-seconds budget.
 *
 * With Upstash Redis (or Vercel KV, which is Upstash) configured, values and
 * the Explorer turn are shared. Without it, everything stays in memory.
 */
export interface SharedCache {
  readonly shared: boolean;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Take `key` for `ttlMs` if nobody holds it. True when this caller got it. */
  claim(key: string, ttlMs: number): Promise<boolean>;
}

export function memoryCache(now: () => number = () => Date.now()): SharedCache {
  const store = new Map<string, { until: number; value: unknown }>();
  const live = (key: string) => {
    const e = store.get(key);
    if (e && e.until > now()) return e;
    store.delete(key);
    return undefined;
  };
  return {
    shared: false,
    get: <T>(key: string) => Promise.resolve(live(key)?.value as T | undefined),
    set(key, value, ttlMs) {
      store.set(key, { until: now() + ttlMs, value });
      return Promise.resolve();
    },
    claim(key, ttlMs) {
      if (live(key)) return Promise.resolve(false);
      store.set(key, { until: now() + ttlMs, value: 1 });
      return Promise.resolve(true);
    },
  };
}

/** Upstash's REST API: one POST per command, `["SET", key, value, ...]`. */
export function upstashCache(opts: {
  url: string;
  token: string;
  prefix?: string;
  fetch?: typeof fetch;
}): SharedCache {
  const f = opts.fetch ?? fetch;
  const prefix = opts.prefix ?? "crowdline:";
  async function command(args: (string | number)[]): Promise<unknown> {
    const res = await f(opts.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Cache answered ${res.status}`);
    return ((await res.json()) as { result?: unknown }).result;
  }
  return {
    shared: true,
    async get<T>(key: string) {
      const raw = await command(["GET", prefix + key]);
      return typeof raw === "string" ? (JSON.parse(raw) as T) : undefined;
    },
    async set(key, value, ttlMs) {
      await command(["SET", prefix + key, JSON.stringify(value), "PX", Math.ceil(ttlMs)]);
    },
    async claim(key, ttlMs) {
      return (await command(["SET", prefix + key, "1", "NX", "PX", Math.ceil(ttlMs)])) === "OK";
    },
  };
}

export interface CacheEnv {
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

export function cacheFromEnv(env: CacheEnv, now?: () => number): SharedCache {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? upstashCache({ url, token }) : memoryCache(now);
}

/**
 * Wait until this instance holds the shared Explorer turn. Gives up after
 * `maxWaitMs` and goes anyway: a rare 429 is better than a hung request.
 */
export function explorerGate(
  cache: SharedCache,
  opts: { gapMs?: number; maxWaitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): () => Promise<void> {
  const gap = opts.gapMs ?? 5_100;
  const maxWait = opts.maxWaitMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async () => {
    for (let waited = 0; waited < maxWait; waited += 500) {
      try {
        if (await cache.claim("explorer-turn", gap)) return;
      } catch {
        return; // cache down: fall back to this instance's own spacing
      }
      await sleep(500);
    }
  };
}
