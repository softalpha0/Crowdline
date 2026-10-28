import type { Bucket, Finding, OneTimeRefund, Report, ShieldedAge } from "@crowdline/core";
import {
  buildReceipt,
  checkRecipient,
  depositRequest,
  newOneTimeRefund,
  openSession,
  parseTransparent,
  parseZec,
  passphraseProblem,
  refundFromMnemonic,
  sealSession,
} from "@crowdline/core";
import { verifyQuoteSignature } from "@crowdline/oneclick";
import type { ReactNode, SyntheticEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { renderSVG } from "uqr";
import { RoutesPanel, TimingPanel } from "../components/Insights.tsx";
import { WalletGuide } from "../components/WalletGuide.tsx";
import { Button, Card, Container, ErrorNote, ModeBadge, ScoreDial } from "../components/ui.tsx";
import type { AuditResult, Config, Destination, QuoteResult, StatusResult } from "../lib/api.ts";
import { TERMINAL, api, confidentialityOf, messageOf } from "../lib/api.ts";
import { crowdLabel, scoreTone, short } from "../lib/format.ts";
import { savedSession, shieldedAt } from "../lib/storage.ts";

interface FormValues {
  amountZec: string;
  destinationAsset: string;
  recipient: string;
  confidentiality: "public" | "basic";
  funding: "shielded" | "transparent-fresh" | "transparent-reused";
  shieldedAge: ShieldedAge;
  refund: "reused" | "one-time";
  refundTo: string;
}

const SEVERITY: Record<Finding["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "text-bad border-bad/40" },
  high: { label: "High", cls: "text-bad border-bad/30" },
  medium: { label: "Medium", cls: "text-warn border-warn/40" },
  low: { label: "Low", cls: "text-accent border-accent/40" },
  ok: { label: "OK", cls: "text-good border-good/40" },
};

/** What is kept, encrypted, when the user saves an unfinished swap. */
interface SessionData {
  form: FormValues;
  audit: AuditResult;
  bucket: Bucket;
  mnemonic: string;
  quote?: QuoteResult;
}

/** Prefill the recency question from the last inbound swap, if there was one. */
function defaultAge(): ShieldedAge {
  const at = shieldedAt.read();
  if (!at) return "unknown";
  const h = (Date.now() - at) / 3_600_000;
  return h < 1 ? "under-hour" : h < 24 ? "hours" : "over-day";
}

function sortDestinations(ds: Destination[]): Destination[] {
  const rank = (d: Destination) =>
    (d.symbol === "USDC" ? 0 : d.symbol === "USDT" ? 2 : 4) + (d.blockchain === "sol" ? 0 : 1);
  return ds.slice().sort((a, b) => rank(a) - rank(b) || a.blockchain.localeCompare(b.blockchain));
}

// ───────────────────────── pieces ─────────────────────────

function Step({
  n,
  title,
  sub,
  children,
  id,
}: {
  n: number;
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  id: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (n === 1) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [n]);
  return (
    <section aria-labelledby={id} className="scroll-mt-20">
      <Card className="p-5 sm:p-8">
        <div className="flex gap-4">
          <span className="num mt-1 flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-xs text-muted">
            {n}
          </span>
          <div className="min-w-0">
            <h2 id={id} ref={ref} tabIndex={-1} className="m-0 text-xl font-semibold outline-none">
              {title}
            </h2>
            {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
          </div>
        </div>
        <div className="mt-6 sm:pl-11">{children}</div>
      </Card>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id, hintId)}
      {(error || hint) && (
        <p id={hintId} className={`m-0 text-xs ${error ? "text-bad" : "text-faint"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="num shrink-0 rounded-md border border-line-strong px-2 py-1 text-xs text-muted hover:text-fg"
      onClick={() => {
        // The clipboard API only exists on https and localhost.
        if (!window.isSecureContext) return;
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => {
            setDone(false);
          }, 1500);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function KV({ k, v, copy }: { k: string; v: ReactNode; copy?: string }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="num m-0 flex min-w-0 items-start justify-between gap-3 text-sm break-all">
        <span className="min-w-0">{v}</span>
        {copy && <Copy text={copy} />}
      </dd>
    </div>
  );
}

function Findings({ report }: { report: Report }) {
  return (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {report.findings.map((f) => {
        const s = SEVERITY[f.severity];
        return (
          <li key={f.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:gap-4">
            <span
              className={`num h-fit shrink-0 self-start rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wider ${s.cls}`}
            >
              {s.label}
            </span>
            <div className="min-w-0">
              <p className="m-0 font-medium">{f.title}</p>
              <p className="mt-1 text-sm text-muted">{f.detail}</p>
              {f.fix && <p className="mt-2 text-sm text-good">Fix: {f.fix}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── step 1 ─────────────────────────

function DescribeStep({
  config,
  initial,
  preset,
  onAudited,
}: {
  config: Config;
  initial?: FormValues;
  /** A route picked from the comparison: switch to it, keeping what still applies. */
  preset?: { destinationAsset: string; n: number };
  onAudited: (form: FormValues, audit: AuditResult) => void;
}) {
  const dests = useMemo(() => sortDestinations(config.destinations), [config.destinations]);
  const [v, setV] = useState<FormValues>(
    () =>
      initial ?? {
        amountZec: "",
        destinationAsset: dests[0]?.assetId ?? "",
        recipient: "",
        confidentiality: "public",
        funding: "shielded",
        shieldedAge: defaultAge(),
        refund: "reused",
        refundTo: "",
      },
  );
  const recipientRef = useRef<HTMLInputElement>(null);
  // A route picked below: adjust the form while rendering, then move focus.
  const [presetSeen, setPresetSeen] = useState(preset?.n);
  if (preset && preset.n !== presetSeen) {
    setPresetSeen(preset.n);
    const was = dests.find((d) => d.assetId === v.destinationAsset)?.blockchain;
    const now = dests.find((d) => d.assetId === preset.destinationAsset)?.blockchain;
    setV({
      ...v,
      destinationAsset: preset.destinationAsset,
      recipient: was === now ? v.recipient : "",
    });
  }
  useEffect(() => {
    if (!preset) return;
    recipientRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth" });
    recipientRef.current?.focus({ preventScroll: true });
  }, [preset]);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => {
    setV((p) => ({ ...p, [k]: value }));
  };
  const dest = dests.find((d) => d.assetId === v.destinationAsset);
  const usdValue = (() => {
    try {
      return (Number(parseZec(v.amountZec)) / 1e8) * (config.zec?.price ?? 0);
    } catch {
      return 0;
    }
  })();

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(undefined);
    const errs: typeof errors = {};
    try {
      if (parseZec(v.amountZec) <= 0n) throw new Error();
    } catch {
      errs.amountZec = "Enter a ZEC amount, like 3.417.";
    }
    const bad = dest ? checkRecipient(dest.blockchain, v.recipient) : "Pick a destination.";
    if (bad) errs.recipient = bad;
    if (v.refundTo && !parseTransparent(v.refundTo)) {
      errs.refundTo = "Not a valid Zcash transparent address (t1… or t3…).";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      onAudited(v, await api.audit(v));
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field
        label="You send"
        error={errors.amountZec}
        hint={
          usdValue ? `≈ $${usdValue.toFixed(2)} at $${config.zec?.price.toFixed(2)}` : undefined
        }
      >
        {(id, d) => (
          <div className="relative">
            <input
              id={id}
              aria-describedby={d}
              aria-invalid={Boolean(errors.amountZec)}
              className="field num pr-14"
              inputMode="decimal"
              autoComplete="off"
              placeholder="3.417"
              value={v.amountZec}
              onChange={(e) => {
                set("amountZec", e.target.value.trim());
              }}
            />
            <span className="num pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-faint">
              ZEC
            </span>
          </div>
        )}
      </Field>
      <Field label="You receive">
        {(id) => (
          <select
            id={id}
            className="field"
            value={v.destinationAsset}
            onChange={(e) => {
              set("destinationAsset", e.target.value);
            }}
          >
            {dests.map((d) => (
              <option key={d.assetId} value={d.assetId}>
                {d.symbol} on {d.blockchain}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field
          label="Payout address"
          error={errors.recipient}
          hint={`Your wallet on ${dest?.blockchain ?? "the destination chain"}, not a token contract.`}
        >
          {(id, d) => (
            <input
              id={id}
              ref={recipientRef}
              aria-describedby={d}
              aria-invalid={Boolean(errors.recipient)}
              className="field num text-sm"
              autoComplete="off"
              spellCheck={false}
              placeholder="Destination wallet address"
              value={v.recipient}
              onChange={(e) => {
                set("recipient", e.target.value);
              }}
            />
          )}
        </Field>
      </div>

      <fieldset className="m-0 border-0 border-t border-line p-0 pt-6 sm:col-span-2">
        <legend className="sr-only">How you'd do it today</legend>
        <p aria-hidden="true" className="eyebrow m-0 mb-5">
          How you'd do it today
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Swap visibility">
            {(id) => (
              <select
                id={id}
                className="field"
                value={v.confidentiality}
                onChange={(e) => {
                  set("confidentiality", e.target.value as FormValues["confidentiality"]);
                }}
              >
                <option value="public">Public (the 1Click default)</option>
                <option value="basic">Confidential Intents (basic)</option>
              </select>
            )}
          </Field>
          <Field label="Deposit paid from">
            {(id) => (
              <select
                id={id}
                className="field"
                value={v.funding}
                onChange={(e) => {
                  set("funding", e.target.value as FormValues["funding"]);
                }}
              >
                <option value="shielded">My shielded balance</option>
                <option value="transparent-fresh">A new transparent address</option>
                <option value="transparent-reused">A transparent address I've used before</option>
              </select>
            )}
          </Field>
          {v.funding === "shielded" && (
            <Field
              label="Those funds were shielded"
              hint="Money that enters and leaves the pool close together, in similar amounts, can be matched."
            >
              {(id, d) => (
                <select
                  id={id}
                  aria-describedby={d}
                  className="field"
                  value={v.shieldedAge}
                  onChange={(e) => {
                    set("shieldedAge", e.target.value as ShieldedAge);
                  }}
                >
                  <option value="unknown">Not sure</option>
                  <option value="over-day">More than a day ago</option>
                  <option value="hours">Within the last day</option>
                  <option value="under-hour">Within the last hour</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Refunds go to">
            {(id) => (
              <select
                id={id}
                className="field"
                value={v.refund}
                onChange={(e) => {
                  set("refund", e.target.value as FormValues["refund"]);
                }}
              >
                <option value="reused">My usual transparent address</option>
                <option value="one-time">A one-time address</option>
              </select>
            )}
          </Field>
          <Field
            label="Usual refund address"
            error={errors.refundTo}
            hint="Optional. Checked against swap history, never used."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                aria-invalid={Boolean(errors.refundTo)}
                className="field num text-sm"
                autoComplete="off"
                spellCheck={false}
                placeholder="t1…"
                value={v.refundTo}
                onChange={(e) => {
                  set("refundTo", e.target.value.trim());
                }}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="flex flex-col gap-3 sm:col-span-2">
        <ErrorNote>{error}</ErrorNote>
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? "Sizing your crowd…" : "Audit this swap"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ───────────────────────── step 2 ─────────────────────────

function AuditStep({
  audit,
  bucket,
  onBucket,
  onHarden,
  hardened,
  usd,
  destinations,
  onRoute,
}: {
  audit: AuditResult;
  bucket?: Bucket;
  onBucket: (b: Bucket) => void;
  onHarden: () => void;
  hardened: boolean;
  /** Value of the chosen amount, for the timing and route views. */
  usd: number;
  destinations: Destination[];
  onRoute: (assetId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-center gap-4 rounded-lg border border-line bg-ink px-2 py-6 sm:gap-12">
        <ScoreDial
          size={104}
          score={audit.before.score}
          tone={scoreTone(audit.before.score)}
          label="As you'd send it"
        />
        <span className="text-xl text-faint" aria-hidden="true">
          →
        </span>
        <ScoreDial
          size={104}
          score={audit.after.score}
          tone={scoreTone(audit.after.score)}
          label="With Crowdline"
        />
      </div>
      <p className="mt-3 text-center text-xs text-faint">
        ≈{crowdLabel(audit.before.crowd.k)} → ≈{crowdLabel(audit.after.crowd.k)} look-alike swaps in
        a ±15 min search.
      </p>

      <h3 className="mt-10 text-base font-semibold">Leaks in your current setup</h3>
      <Findings report={audit.before} />

      <h3 className="mt-8 text-base font-semibold">Pick an amount that hides in a crowd</h3>
      <p className="mt-1 text-sm text-muted">
        Crowd is how many swaps an observer would have to tell apart from yours. What you keep back
        stays in your shielded wallet.
      </p>
      <fieldset className="m-0 mt-4 border-0 p-0">
        <legend className="sr-only">Amount to send</legend>
        <div className="grid gap-2">
          {audit.buckets.map((b) => {
            const on = bucket?.amountZec === b.amountZec;
            return (
              <label
                key={b.amountZec}
                className={`flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3 transition-colors ${
                  on ? "border-accent bg-accent/5" : "border-line hover:border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  name="bucket"
                  className="accent-[var(--color-accent)]"
                  checked={on}
                  onChange={() => {
                    onBucket(b);
                  }}
                />
                <span className="num min-w-24 font-medium">{b.amountZec} ZEC</span>
                <span className="num text-sm text-good">{crowdLabel(b.crowd.k)}× crowd</span>
                <span className="text-sm text-muted">
                  {b.holdBackZec === "0" ? "send all" : `keep ${b.holdBackZec} shielded`}
                </span>
                <span className="ml-auto text-xs text-faint">
                  {
                    {
                      "as-entered": "as typed",
                      "round-number": "round number",
                      "crowd-mode": "common amount",
                    }[b.reason]
                  }
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {audit.after.crowd.k < 2 && (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          Thin market: even the best amount has a small crowd right now. Crowdline cannot create
          one. The views below show when and where swaps like this are more common.
        </p>
      )}
      {usd > 0 && (
        <div className="mt-6 grid gap-4">
          <TimingPanel destinationAsset={audit.hardened.destinationAsset} usd={usd} />
          <RoutesPanel
            usd={usd}
            destinationAsset={audit.hardened.destinationAsset}
            destinations={destinations}
            onPick={onRoute}
          />
        </div>
      )}
      <div className="mt-6">
        <Button onClick={onHarden} disabled={!bucket}>
          {hardened ? "Make a new refund address" : "Harden this swap"}
        </Button>
      </div>
    </>
  );
}

// ───────────────────────── step 3 ─────────────────────────

function SaveSession({
  saved,
  onSave,
  onForget,
}: {
  saved: boolean;
  onSave: (passphrase: string) => Promise<void>;
  onForget: () => void;
}) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (saved) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-good/40 bg-good/5 px-3 py-2 text-sm text-good">
        Saved on this device, encrypted with your passphrase. It updates as the swap goes on.
        <button type="button" className="text-muted underline hover:text-fg" onClick={onForget}>
          Forget it
        </button>
      </div>
    );
  }
  return (
    <details className="mt-6 rounded-lg border border-line bg-ink p-4 text-sm">
      <summary className="cursor-pointer font-medium">Keep this swap if the tab closes</summary>
      <p className="mt-2 text-muted">
        Encrypts the recovery words and the quote with a passphrase (PBKDF2 and AES-GCM in this
        browser) and keeps them in this browser's storage. Nothing is sent anywhere. Reopen /app to
        resume.
      </p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const p = passphraseProblem(pass);
          if (p) {
            setError(p);
            return;
          }
          setBusy(true);
          onSave(pass).then(
            () => {
              setPass("");
            },
            (x: unknown) => {
              setError(messageOf(x));
              setBusy(false);
            },
          );
        }}
      >
        <input
          type="password"
          className="field max-w-64 text-sm"
          autoComplete="new-password"
          placeholder="Passphrase"
          aria-label="Passphrase"
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" variant="secondary" disabled={busy}>
          Save encrypted
        </Button>
      </form>
      {error && <p className="mt-2 mb-0 text-xs text-bad">{error}</p>}
    </details>
  );
}

function ResumeSession({ onOpen }: { onOpen: (data: SessionData) => void }) {
  const [sealed, setSealed] = useState(() => savedSession.read());
  const [mins] = useState(() =>
    sealed ? Math.round((Date.now() - Date.parse(sealed.savedAt)) / 60_000) : 0,
  );
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!sealed) return null;
  const ago =
    mins < 60
      ? `${mins} min`
      : mins < 2880
        ? `${Math.round(mins / 60)} h`
        : `${Math.round(mins / 1440)} days`;
  return (
    <Card className="mb-5 p-5">
      <p className="m-0 font-medium">You have an unfinished swap saved {ago} ago</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          openSession<SessionData>(sealed, pass).then(
            (d) => {
              onOpen(d);
              setSealed(null);
            },
            (x: unknown) => {
              setError(messageOf(x));
              setBusy(false);
            },
          );
        }}
      >
        <input
          type="password"
          className="field max-w-64 text-sm"
          autoComplete="current-password"
          placeholder="Passphrase"
          aria-label="Passphrase"
          value={pass}
          onChange={(e) => {
            setPass(e.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" disabled={busy || !pass}>
          {busy ? "Opening…" : "Resume"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (!window.confirm("Delete the saved swap? Its recovery words go with it.")) return;
            savedSession.clear();
            setSealed(null);
          }}
        >
          Delete it
        </Button>
      </form>
      {error && <p className="mt-2 mb-0 text-xs text-bad">{error}</p>}
    </Card>
  );
}

function RefundStep({
  refund,
  quotesEnabled,
  onQuote,
  session,
}: {
  refund: OneTimeRefund;
  quotesEnabled: boolean;
  onQuote: () => Promise<void>;
  session: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const savedId = useId();
  return (
    <>
      <dl className="m-0 rounded-lg border border-line bg-ink px-4">
        <KV k="Refund address" v={refund.address} copy={refund.address} />
        <KV k="Derivation" v={refund.path} />
      </dl>
      <p className="mt-4 text-sm text-muted">
        If the swap fails, 1Click refunds here. Save these 24 words: restoring them in a wallet that
        scans transparent addresses, or importing the key below, is how you would recover a refund.
        They exist only in this tab.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            setShown((s) => !s);
          }}
          aria-expanded={shown}
        >
          {shown ? "Hide recovery words" : "Show recovery words"}
        </Button>
        {shown && <Copy text={refund.mnemonic} label="Copy words" />}
      </div>
      <ol
        className={`num mt-4 grid list-none grid-cols-2 gap-2 p-0 text-sm sm:grid-cols-4 ${shown ? "" : "select-none blur-sm"}`}
        aria-hidden={!shown}
      >
        {refund.mnemonic.split(" ").map((w, i) => (
          <li key={i} className="rounded-md border border-line bg-ink px-2 py-1.5">
            <span className="mr-2 text-faint">{String(i + 1).padStart(2, "0")}</span>
            {shown ? w : "••••"}
          </li>
        ))}
      </ol>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">
          Single-key import (WIF)
        </summary>
        <div className="mt-2 flex items-start gap-3 rounded-md border border-line bg-ink p-3">
          <code className="num min-w-0 break-all text-xs">{refund.wif}</code>
          <Copy text={refund.wif} />
        </div>
      </details>
      <div className="mt-6 flex items-center gap-3">
        <input
          id={savedId}
          type="checkbox"
          className="size-4 accent-[var(--color-accent)]"
          checked={saved}
          onChange={(e) => {
            setSaved(e.target.checked);
          }}
        />
        <label htmlFor={savedId} className="text-sm">
          I saved the recovery words somewhere safe
        </label>
      </div>
      {session}
      <div className="mt-5 flex flex-col gap-3">
        {!quotesEnabled && (
          <ErrorNote>
            This server cannot request confidential quotes: it has no 1Click API key, or 1Click is
            unreachable.
          </ErrorNote>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div>
          <Button
            disabled={!saved || busy || !quotesEnabled}
            aria-busy={busy}
            onClick={async () => {
              setError(undefined);
              setBusy(true);
              try {
                await onQuote();
              } catch (x) {
                setError((x as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Asking 1Click…" : "Get a confidential quote"}
          </Button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────── step 4 ─────────────────────────

const STATUS_COPY: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen on Zcash",
  INCOMPLETE_DEPOSIT: "Deposit is less than the quote",
  PROCESSING: "Swapping",
  SUCCESS: "Paid out",
  REFUNDED: "Refunded to your one-time address",
  FAILED: "Failed",
};

function DepositStep({
  quote,
  address,
  amountZec,
  destLabel,
  signed,
  status,
  statusError,
  onReceipt,
}: {
  quote: QuoteResult;
  address: string;
  amountZec: string;
  destLabel: string;
  signed: boolean;
  status?: StatusResult;
  statusError?: string;
  onReceipt: () => void;
}) {
  const uri = depositRequest(address, parseZec(amountZec));
  const qr = useMemo(
    () => renderSVG(uri, { border: 2, whiteColor: "#ffffff", blackColor: "#0b0c0e" }),
    [uri],
  );
  const conf = confidentialityOf(quote);
  // The request deadline is when refunds start. quote.deadline is only when the
  // deposit address stops being watched, days later, so it is not shown.
  const payBy =
    typeof quote.quoteRequest.deadline === "string"
      ? new Date(quote.quoteRequest.deadline)
      : undefined;
  const links = status
    ? [
        ...status.swapDetails.originChainTxHashes.map((t) => ["Zcash deposit", t] as const),
        ...status.swapDetails.destinationChainTxHashes.map((t) => ["Payout", t] as const),
      ]
    : [];
  const tone =
    status?.status === "SUCCESS"
      ? "text-good"
      : status && ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(status.status)
        ? "text-warn"
        : "text-fg";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span
          className={`num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            signed ? "border-good/40 text-good" : "border-bad/40 text-bad"
          }`}
        >
          {signed ? "✓ Signed by 1Click" : "✗ Signature did not verify"}
        </span>
        <span
          className={`num inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${
            conf === "public" ? "border-bad/40 text-bad" : "border-good/40 text-good"
          }`}
          title="1Click does not sign this field, so it is checked separately."
        >
          Confidentiality: {conf}
        </span>
      </div>
      <div className="mt-6 grid gap-6 sm:grid-cols-[auto_1fr]">
        <div
          className="mx-auto w-52 overflow-hidden rounded-lg bg-white p-1 sm:mx-0 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          role="img"
          aria-label={`ZIP-321 payment request for ${amountZec} ZEC`}
          // uqr returns static SVG markup built from the payment URI.
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <dl className="m-0 min-w-0 rounded-lg border border-line bg-ink px-4">
          <KV
            k="Send exactly"
            v={<span className="text-base font-semibold">{amountZec} ZEC</span>}
            copy={amountZec}
          />
          <KV k="To" v={address} copy={address} />
          <KV
            k="You get"
            v={`≈ ${quote.quote.amountOutFormatted} ${destLabel} ($${Number(quote.quote.amountOutUsd).toFixed(2)})`}
          />
          <KV
            k="Pay before"
            v={
              payBy
                ? `${payBy.toLocaleString()} (after this the deposit is refunded, not swapped)`
                : "—"
            }
          />
        </dl>
      </div>
      <p className="mt-4 text-sm text-muted">
        Pay from your <strong className="text-fg">shielded</strong> balance. Send exactly this
        amount: anything else is refunded to your one-time address instead of swapped.
      </p>
      <WalletGuide />
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={uri}
          className="inline-flex min-h-11 items-center rounded-lg border border-line-strong px-4 text-sm hover:bg-raised"
        >
          Open in wallet
        </a>
        <Button variant="secondary" onClick={onReceipt}>
          Download receipt
        </Button>
      </div>

      <div className="mt-8 rounded-lg border border-line bg-ink p-4" aria-live="polite">
        <p className="eyebrow m-0">Status</p>
        {status ? (
          <>
            <p className={`mt-2 mb-0 font-medium ${tone}`}>
              {STATUS_COPY[status.status] ?? status.status.replace(/_/g, " ")}
              <span className="num ml-2 text-xs font-normal text-faint">
                updated {new Date(status.updatedAt).toLocaleTimeString()}
              </span>
            </p>
            {links.length > 0 && (
              <ul className="num mt-3 list-none space-y-1 p-0 text-sm">
                {links.map(([label, t]) => (
                  <li key={t.hash}>
                    <span className="text-muted">{label}: </span>
                    <a
                      className="text-accent hover:underline"
                      href={t.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(t.hash, 10, 8)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {status.swapDetails.refundReason && (
              <p className="mt-2 text-sm text-warn">Reason: {status.swapDetails.refundReason}</p>
            )}
            {status.status === "REFUNDED" && (
              <p className="mt-3 mb-0 text-sm">
                <Link className="text-accent hover:underline" to="/recover">
                  Recover the refund
                </Link>{" "}
                <span className="text-muted">
                  with your recovery words, without importing them into a wallet.
                </span>
              </p>
            )}
          </>
        ) : (
          <div className="skeleton mt-3 h-5 w-48" />
        )}
        {statusError && (
          <p className="mt-2 text-xs text-faint">Status check failed ({statusError}); retrying.</p>
        )}
      </div>
    </>
  );
}

// ───────────────────────── page ─────────────────────────

export default function SwapApp() {
  const [config, setConfig] = useState<Config>();
  const [configError, setConfigError] = useState<string>();
  const [form, setForm] = useState<FormValues>();
  const [audit, setAudit] = useState<AuditResult>();
  const [bucket, setBucket] = useState<Bucket>();
  const [refund, setRefund] = useState<OneTimeRefund>();
  const [quote, setQuote] = useState<QuoteResult>();
  const [signed, setSigned] = useState(false);
  const [status, setStatus] = useState<StatusResult>();
  const [statusError, setStatusError] = useState<string>();
  const [preset, setPreset] = useState<{ destinationAsset: string; n: number }>();
  const [restored, setRestored] = useState<FormValues>();
  /** Passphrase for the saved session, kept in memory only so it can be updated. */
  const [sessionKey, setSessionKey] = useState<string>();

  useEffect(() => {
    document.title = "Check a swap · Crowdline";
    api.config().then(setConfig, (e: unknown) => {
      setConfigError(messageOf(e));
    });
  }, []);

  // Poll the swap until it settles.
  const depositAddress = quote?.quote.depositAddress;
  useEffect(() => {
    if (!depositAddress) return;
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api.status(depositAddress);
        if (stop) return;
        setStatus(s);
        setStatusError(undefined);
        if (TERMINAL.includes(s.status)) return;
      } catch (e) {
        if (!stop) setStatusError((e as Error).message);
      }
      if (!stop) timer = window.setTimeout(() => void tick(), 10_000);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [depositAddress]);

  // Keep the saved copy current as the quote arrives; drop it once paid out.
  useEffect(() => {
    if (!sessionKey || !form || !audit || !bucket || !refund) return;
    if (status?.status === "SUCCESS") {
      savedSession.clear();
      return;
    }
    const data: SessionData = { form, audit, bucket, mnemonic: refund.mnemonic, quote };
    void sealSession(data, sessionKey).then(savedSession.write);
  }, [sessionKey, form, audit, bucket, refund, quote, status?.status]);

  function resume(d: SessionData) {
    setRestored(d.form);
    setForm(d.form);
    setAudit(d.audit);
    setBucket(d.bucket);
    setRefund(refundFromMnemonic(d.mnemonic, "mainnet"));
    setQuote(d.quote);
    setSigned(d.quote ? verifyQuoteSignature(d.quote) : false);
    setStatus(undefined);
  }

  // The recovery words exist only in this tab unless saved: warn before it closes mid-swap.
  useEffect(() => {
    if (!refund || sessionKey || status?.status === "SUCCESS") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [refund, sessionKey, status]);

  const dest = config?.destinations.find((d) => d.assetId === form?.destinationAsset);
  const destLabel = dest ? `${dest.symbol} on ${dest.blockchain}` : "";

  function downloadReceipt() {
    const receipt = buildReceipt({
      crowdData: audit?.mode ?? "demo",
      before: audit?.before,
      after: audit?.after,
      chosenAmountZec: bucket?.amountZec,
      refund: refund && { address: refund.address, path: refund.path },
      quote,
      signatureValid: quote ? signed : undefined,
      status,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `crowdline-receipt-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Swap check</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Check a swap before it leaves Zcash
          </h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          Crowd data <ModeBadge mode={configError ? undefined : config?.mode} />
        </div>
      </div>
      {config?.mode === "demo" && (
        <p className="mb-6 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
          Demo crowd data: this server has no Explorer key, so crowd sizes come from synthetic
          flows, not real swaps.
        </p>
      )}

      {!audit && <ResumeSession onOpen={resume} />}

      <div className="flex flex-col gap-5">
        <Step
          n={1}
          id="s1"
          title="Describe the swap"
          sub="Shielded ZEC out to another chain through NEAR Intents. Nothing is sent yet."
        >
          {configError ? (
            <ErrorNote>Could not load routes from the server: {configError}</ErrorNote>
          ) : !config ? (
            <div aria-busy="true" className="grid gap-5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : (
            <DescribeStep
              key={restored ? "restored" : "new"}
              config={config}
              initial={restored}
              preset={preset}
              onAudited={(f, a) => {
                setForm(f);
                setAudit(a);
                setBucket(a.buckets[0]);
                setRefund(undefined);
                setQuote(undefined);
                setStatus(undefined);
              }}
            />
          )}
        </Step>

        {audit && (
          <Step
            n={2}
            id="s2"
            title="What an observer learns"
            sub={`${audit.flowsChecked.toLocaleString("en-US")} recent swaps checked${audit.mode === "demo" ? " (demo data)" : ""}.`}
          >
            <AuditStep
              audit={audit}
              bucket={bucket}
              hardened={Boolean(refund)}
              onBucket={(b) => {
                setBucket(b);
                setQuote(undefined);
                setStatus(undefined);
              }}
              onHarden={() => {
                setRefund(newOneTimeRefund("mainnet"));
                setQuote(undefined);
                setStatus(undefined);
              }}
              usd={bucket ? Number(bucket.amountZec) * (config?.zec?.price ?? 0) : 0}
              destinations={config?.destinations ?? []}
              onRoute={(destinationAsset) => {
                setPreset((p) => ({ destinationAsset, n: (p?.n ?? 0) + 1 }));
              }}
            />
          </Step>
        )}

        {refund && form && bucket && audit && (
          <Step
            key={refund.address}
            n={3}
            id="s3"
            title="One-time refund address"
            sub="Made in this browser for this swap only. Crowdline's server never sees the key."
          >
            <RefundStep
              refund={refund}
              session={
                <SaveSession
                  saved={Boolean(sessionKey)}
                  onSave={async (pass) => {
                    savedSession.write(
                      await sealSession(
                        { form, audit, bucket, mnemonic: refund.mnemonic, quote },
                        pass,
                      ),
                    );
                    setSessionKey(pass);
                  }}
                  onForget={() => {
                    savedSession.clear();
                    setSessionKey(undefined);
                  }}
                />
              }
              quotesEnabled={Boolean(config?.quotes)}
              onQuote={async () => {
                const q = await api.quote({
                  destinationAsset: form.destinationAsset,
                  amountZec: bucket.amountZec,
                  recipient: form.recipient,
                  refundTo: refund.address,
                  confidentiality: "basic",
                });
                const ok = verifyQuoteSignature(q);
                if (!q.quote.depositAddress) throw new Error("1Click returned no deposit address.");
                setSigned(ok);
                setQuote(q);
              }}
            />
          </Step>
        )}

        {quote && bucket && (
          <Step
            n={4}
            id="s4"
            title="Pay from your shielded balance"
            sub="Confidential Intents, exact input, one-time refund."
          >
            {signed ? (
              <DepositStep
                quote={quote}
                address={quote.quote.depositAddress ?? ""}
                amountZec={bucket.amountZec}
                destLabel={destLabel}
                signed={signed}
                status={status}
                statusError={statusError}
                onReceipt={downloadReceipt}
              />
            ) : (
              <ErrorNote>
                This quote's signature did not verify against 1Click's key, so Crowdline will not
                show its deposit address. Request a new quote.
              </ErrorNote>
            )}
          </Step>
        )}
      </div>
    </Container>
  );
}
