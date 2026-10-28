/**
 * Keep an unfinished swap (refund phrase, quote, chosen amount) on this
 * device across a closed tab, encrypted under a passphrase the user picks.
 * WebCrypto only: PBKDF2-SHA256 derives an AES-256-GCM key. Nothing here is
 * ever sent anywhere; the caller decides where the sealed blob is stored.
 */

export const SESSION_VERSION = 1;
const ITERATIONS = 310_000;

export interface SealedSession {
  v: number;
  /** When it was saved, so the resume prompt can say "from 20 minutes ago". */
  savedAt: string;
  salt: string;
  iv: string;
  data: string;
}

const b64 = {
  to: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  from: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function keyFrom(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function passphraseProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  return null;
}

/** Encrypt `value` (any JSON) under `passphrase`. */
export async function sealSession(
  value: unknown,
  passphrase: string,
  opts: { now?: Date; iterations?: number } = {},
): Promise<SealedSession> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, opts.iterations ?? ITERATIONS);
  const plain = new TextEncoder().encode(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  );
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    v: SESSION_VERSION,
    savedAt: (opts.now ?? new Date()).toISOString(),
    salt: b64.to(salt),
    iv: b64.to(iv),
    data: b64.to(data),
  };
}

/** Decrypt a sealed session. Throws "Wrong passphrase" if it does not open. */
export async function openSession<T>(
  sealed: SealedSession,
  passphrase: string,
  opts: { iterations?: number } = {},
): Promise<T> {
  if (sealed.v !== SESSION_VERSION)
    throw new Error("This saved swap is from another version of Crowdline");
  const key = await keyFrom(passphrase, b64.from(sealed.salt), opts.iterations ?? ITERATIONS);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64.from(sealed.iv) },
      key,
      b64.from(sealed.data),
    );
  } catch {
    throw new Error("Wrong passphrase");
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Parse what was stored; null when nothing usable is there. */
export function readSealed(text: string | null): SealedSession | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Partial<SealedSession>;
    return s.v && s.salt && s.iv && s.data && s.savedAt ? (s as SealedSession) : null;
  } catch {
    return null;
  }
}
