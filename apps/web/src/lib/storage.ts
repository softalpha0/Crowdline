import type { SealedSession } from "@crowdline/core";
import { readSealed } from "@crowdline/core";

/**
 * localStorage, wrapped: it throws in private windows and some embeds, and
 * nothing in Crowdline may break because of that.
 */
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function put(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const SESSION = "crowdline.session.v1";
const SHIELDED_AT = "crowdline.shieldedAt";

/** The sealed (encrypted) unfinished swap, if one is saved on this device. */
export const savedSession = {
  read: (): SealedSession | null => readSealed(get(SESSION)),
  write: (s: SealedSession) => {
    put(SESSION, JSON.stringify(s));
  },
  clear: () => {
    put(SESSION, null);
  },
};

/** When ZEC last arrived through the inbound flow, to prefill the recency question. */
export const shieldedAt = {
  read: (): number | null => {
    const n = Number(get(SHIELDED_AT));
    return Number.isFinite(n) && n > 0 ? n : null;
  },
  mark: (at = Date.now()) => {
    put(SHIELDED_AT, String(at));
  },
};
