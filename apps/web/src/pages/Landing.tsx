import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ButtonLink, Card, Container, ModeBadge, ScoreDial } from "../components/ui.tsx";
import type { Backtest, Stats } from "../lib/api.ts";
import { api, messageOf } from "../lib/api.ts";
import { usd, usdCompact } from "../lib/format.ts";
import { LINKS } from "../lib/links.ts";

const LEAKS = [
  {
    n: "01",
    title: "Public swap record",
    body: "In public mode the NEAR Intents Explorer lists your Zcash deposit and your payout in the same row. Nobody has to guess.",
    fix: "Quote with confidentiality: basic.",
    before: "Linked",
    after: "Confidential",
  },
  {
    n: "02",
    title: "Unique amount",
    body: "Your deposit and payout land minutes apart at almost the same dollar value. If nobody else swapped that much, it was you.",
    fix: "Send a crowded amount; keep the rest shielded.",
    before: "1 look-alike",
    after: "Still thin",
    afterTone: "warn",
  },
  {
    n: "03",
    title: "Reused refund address",
    body: "1Click refunds ZEC to transparent addresses only. Reuse one and every swap that refunds there is tied together.",
    fix: "A one-time t-address made on your device.",
    before: "Reused",
    after: "One-time",
  },
  {
    n: "04",
    title: "Transparent funding",
    body: "Paying the deposit from a t-address with history joins this swap to that history, in public.",
    fix: "Pay the ZIP-321 request from your shielded balance.",
    before: "t-address",
    after: "Shielded",
  },
];

function HeroVisual() {
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Measured · 3.417 ZEC → USDC on Solana</span>
        <span className="num shrink-0 rounded-full border border-good/40 px-2 py-0.5 text-xs whitespace-nowrap text-good">
          live data
        </span>
      </div>
      <div className="mt-6 flex items-center justify-around gap-4">
        <ScoreDial score={10} tone="bad" size={108} label="As you'd send it" />
        <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true" className="shrink-0">
          <path
            d="M0 6h25M20 1l5 5-5 5"
            fill="none"
            stroke="var(--color-faint)"
            strokeWidth="1.5"
          />
        </svg>
        <ScoreDial score={40} tone="warn" size={108} label="Through Crowdline" />
      </div>
      <ul className="mt-6 divide-y divide-line border-t border-line p-0">
        {LEAKS.map((l) => (
          <li key={l.n} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-muted">{l.title}</span>
            <span
              className="num flex shrink-0 items-center gap-2 text-xs"
              role="img"
              aria-label={`${l.before}, becomes ${l.after}`}
            >
              <span className="text-bad line-through decoration-bad/50">{l.before}</span>
              <span className="text-faint">→</span>
              <span className={l.afterTone === "warn" ? "text-warn" : "text-good"}>{l.after}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-0 text-xs text-faint">
        Real Explorer data, Oct 27, 2026, 21:40 UTC: 1,144 recent swaps checked. Hardening adds 30
        points; the amount adds almost none, because at most amounts the crowd that hour was about
        1.
      </p>
    </Card>
  );
}

function Stat({ label, value, note }: { label: string; value?: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-line py-5 sm:border-l sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="num m-0 text-xl font-medium sm:text-2xl">
        {value ?? <span className="skeleton inline-block h-8 w-24 align-middle" />}
      </dd>
      {note && <p className="m-0 text-xs text-faint">{note}</p>}
    </div>
  );
}

function LiveStrip() {
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.stats().then(setStats, (e: unknown) => {
      setError(messageOf(e));
    });
  }, []);
  const top = stats?.commonAmounts[0];
  const demo = stats?.mode === "demo";
  return (
    <section aria-labelledby="live-title" className="border-y border-line bg-panel">
      <Container className="py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="live-title" className="eyebrow m-0">
            Swaps out of Zcash · last {stats?.lookbackHours ?? 24}h
          </h2>
          <ModeBadge mode={error ? undefined : stats?.mode} />
          {demo && (
            <span className="text-xs text-warn">
              Synthetic flows: this server has no Explorer key.
            </span>
          )}
        </div>
        {error ? (
          <p className="mt-4 text-sm text-muted">Live numbers are unavailable right now: {error}</p>
        ) : stats && stats.zecSwaps === 0 ? (
          <p className="mt-4 text-sm text-muted">
            The Explorer returned no finished swaps out of Zcash in this window.
          </p>
        ) : (
          <dl className="m-0 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <Stat label="Finished swaps" value={stats?.zecSwaps.toLocaleString("en-US")} />
            <Stat label="Volume" value={stats && usdCompact(stats.zecVolumeUsd)} />
            <Stat label="Median swap" value={stats && usd(stats.medianSwapUsd)} />
            <Stat
              label="Median crowd, common amounts"
              value={stats && `${stats.medianCommonCrowd.toFixed(1)}×`}
              note={
                top
                  ? `Most repeated: ${top.amountZec} ZEC, ${top.count} times. Zcash-origin swaps only, so a lower bound.`
                  : stats && "No amount repeated in this window."
              }
            />
          </dl>
        )}
        {stats?.truncated && (
          <p className="mt-2 text-xs text-faint">
            Busy window: the page limit was reached, so counts are low, not high.
          </p>
        )}
      </Container>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{title}</h2>
      {sub && <p className="mt-4 text-lg text-muted">{sub}</p>}
    </div>
  );
}

const STEPS = [
  {
    t: "Audit",
    d: "Pulls the last 24 hours of 1Click swaps from the NEAR Intents Explorer and counts how many look like yours. Scores the swap out of 100.",
    icon: <path d="M4 18V9M9 18V5M14 18v-7M19 18v-4" strokeLinecap="round" />,
  },
  {
    t: "Rewrite",
    d: "Suggests an amount, never more than you typed, that sits in a bigger crowd. The difference stays in your shielded wallet.",
    icon: <path d="M4 7h12l-3-3M20 17H8l3 3" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    t: "Isolate",
    d: "Makes a fresh transparent refund address in your browser for this swap only. The key never reaches the server.",
    icon: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    t: "Execute",
    d: "Asks 1Click for a confidential, exact-input quote, checks its signature, and shows a ZIP-321 QR you pay from the shielded pool.",
    icon: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
      </>
    ),
  },
];

const LIMITS = [
  {
    t: "The deposit is transparent.",
    d: "NEAR Intents takes ZEC at t-addresses only, so the amount leaving the shielded pool is public. Crowdline makes that amount common. It cannot make it invisible.",
  },
  {
    t: "Thin markets give small crowds.",
    d: "If few people swap similar amounts in the same hour, no rewrite creates a crowd that is not there. The score says so instead of rounding up.",
  },
  {
    t: "No delays, no custody.",
    d: "The payout follows the deposit by minutes. Adding a delay would mean holding your funds, and Crowdline never holds funds.",
  },
  {
    t: "Not anonymity.",
    d: "It reduces how easily your swap links back to you, by a number you can check. It does not promise that nobody can.",
  },
];

const GUARANTEES = [
  [
    "Never holds funds",
    "You pay 1Click's deposit address from your own wallet. Crowdline only builds the request.",
  ],
  [
    "The key stays on your device",
    "Refund keys are generated in the browser. Only the address is sent, and receipts leave the key out.",
  ],
  [
    "Confidential quotes",
    "Every quote is requested with confidentiality: basic and checked against 1Click's signing key.",
  ],
  ["Open source", "MIT licensed. The score, the crowd model and every test are in the repo."],
];

const BUILT_ON = [
  [
    "Zcash",
    "ZIP-321 payment requests, BIP-44 transparent refund keys, shielded payment from ZODL, Zingo or Zkool.",
  ],
  ["NEAR Intents 1Click", "Confidential Intents quotes, deposit addresses, swap status."],
  ["NEAR Intents Explorer", "The public record of finished swaps that the crowd is measured from."],
];

const FAQ = [
  {
    q: "Is this a mixer?",
    a: "No. Crowdline never touches your funds and never pools them with anyone's. It reads public swap data, tells you how linkable your swap is, and changes how you send it: amount, quote mode, refund address and funding source.",
  },
  {
    q: "Why not deposit from a shielded address?",
    a: "NEAR Intents only accepts ZEC at transparent deposit addresses. You can still pay that address straight from your shielded balance, which keeps who sent it private. The amount itself is public, which is why Crowdline picks a common one.",
  },
  {
    q: "What happens if my swap fails?",
    a: "1Click refunds the ZEC to the one-time refund address. Restore the 24 recovery words in a wallet that scans transparent addresses, or import the WIF key, and sweep it back into your shielded balance.",
  },
  {
    q: "Where do the crowd numbers come from?",
    a: "The NEAR Intents Explorer API, the same public record anyone can query. Swaps still in flight report amounts of zero and are left out, as they are for an observer.",
  },
  {
    q: "Does Crowdline see my keys or my wallet?",
    a: "No. It never asks for a wallet connection or a viewing key. The refund key is made in your browser and is never sent anywhere. The server sees the amount, the destination and the payout address, which 1Click needs anyway.",
  },
  {
    q: "Why does the score stop short of 100?",
    a: "Full marks for the amount need about 32 look-alike swaps in the same 30-minute window. Most hours do not have that, and the score reports what is there.",
  },
];

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Replays the observer the score models against yesterday's real swaps. */
function BacktestSection() {
  const [b, setB] = useState<Backtest>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.backtest().then(setB, (e: unknown) => {
      setError(messageOf(e));
    });
  }, []);
  const rows = b?.buckets.filter((x) => x.swaps > 0) ?? [];
  return (
    <section aria-labelledby="backtest" className="border-y border-line bg-panel">
      <Container className="py-16 sm:py-20">
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow m-0">Backtest</p>
          <ModeBadge mode={error ? undefined : b?.mode} />
        </div>
        <h2 id="backtest" className="mt-3 text-2xl font-semibold sm:text-3xl">
          Does the crowd number hold up?
        </h2>
        <p className="mt-3 max-w-2xl text-muted">
          For every swap out of Zcash in the last day, Crowdline plays the observer: it looks for
          payouts of the same asset within ±{b ? b.windowHours * 60 : 15} minutes and ±
          {b ? pct(b.band) : "1%"} of the deposit's dollar value, and counts how many it cannot tell
          apart. If the score is honest, swaps it calls crowded should be hard to pin down.
        </p>
        {error ? (
          <p className="mt-6 text-sm text-faint">Could not run the backtest right now: {error}</p>
        ) : !b ? (
          <div className="skeleton mt-8 h-40 w-full" aria-busy="true" />
        ) : b.swaps === 0 ? (
          <p className="mt-6 text-sm text-faint">No swaps out of Zcash in the window to test.</p>
        ) : (
          <>
            <div className="mt-8 overflow-x-auto">
              <table className="num w-full min-w-[30rem] border-collapse text-left text-sm">
                <thead className="text-xs text-faint">
                  <tr>
                    <th className="border-b border-line py-2 font-normal">
                      Crowd Crowdline predicted
                    </th>
                    <th className="border-b border-line py-2 font-normal">Swaps</th>
                    <th className="border-b border-line py-2 font-normal">Candidates seen</th>
                    <th className="border-b border-line py-2 font-normal">Linked with certainty</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.fromK}>
                      <td className="border-b border-line py-2">
                        {r.toK === null ? `${r.fromK} or more` : `${r.fromK} to ${r.toK}`}
                      </td>
                      <td className="border-b border-line py-2">
                        {r.swaps.toLocaleString("en-US")}
                      </td>
                      <td className="border-b border-line py-2">{r.meanCandidates.toFixed(1)}</td>
                      <td
                        className={`border-b border-line py-2 ${r.uniquelyLinked > 0.5 ? "text-bad" : r.uniquelyLinked > 0.2 ? "text-warn" : "text-good"}`}
                      >
                        {pct(r.uniquelyLinked)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-muted">
              {b.swaps.toLocaleString("en-US")} swaps tested. Overall, an observer with only public
              data would have linked {pct(b.uniquelyLinked)} of them to a single payout.
              {b.trueInBand < 0.9 &&
                ` ${pct(1 - b.trueInBand)} paid out more than ${pct(b.band)} away from what went in (fees, slippage), which this observer misses.`}
            </p>
            <p className="mt-2 text-xs text-faint">
              Deposit and payout are both placed at the swap's creation time, the only time the
              Explorer gives. Public-mode rows link directly; payouts are counted from swaps out of
              Zcash only, so an observer here sees fewer candidates than a real one would and links
              more often. This measures what amount and timing alone give away.{" "}
              {b.mode === "demo" && "These numbers come from demo data, not real swaps."}
            </p>
          </>
        )}
      </Container>
    </section>
  );
}

export function Landing() {
  return (
    <>
      <Container className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div>
          <p className="eyebrow">Zcash → any chain, through NEAR Intents</p>
          <h1 className="mt-5 text-[2.375rem] leading-[1.1] font-semibold sm:text-4xl">
            Check what your shielded ZEC swap leaks before it leaves Zcash. Then fix it.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Crowdline reads the same public swap data an observer would, scores how easily your swap
            links back to you, and rewrites it before you send anything.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink to="/app">Check a swap</ButtonLink>
            <ButtonLink to={LINKS.repo} variant="secondary">
              Read the code
            </ButtonLink>
            {LINKS.video && (
              <ButtonLink to={LINKS.video} variant="ghost">
                Watch the demo
              </ButtonLink>
            )}
          </div>
        </div>
        <HeroVisual />
      </Container>

      <LiveStrip />

      <Container className="py-20 sm:py-28">
        <section aria-labelledby="problem">
          <SectionHead
            eyebrow="The problem"
            title="Shielded ZEC is private until you swap it."
            sub="Four public facts link a swap out of Zcash back to the person who made it. None of them needs a subpoena."
          />
          <ul className="mt-12 grid list-none gap-4 p-0 sm:grid-cols-2">
            {LEAKS.map((l) => (
              <li key={l.n}>
                <Card className="h-full p-6">
                  <span className="num text-xs text-faint">{l.n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{l.title}</h3>
                  <p className="mt-2 text-muted">{l.body}</p>
                  <p className="mt-5 border-t border-line pt-4 text-sm">
                    <span className="text-good">Fix · </span>
                    {l.fix}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      <section
        id="how"
        aria-labelledby="how-title"
        className="scroll-mt-20 border-y border-line bg-panel"
      >
        <Container className="py-20 sm:py-28">
          <SectionHead
            eyebrow="How it works"
            title="Four steps, all before a single zatoshi moves."
          />
          <ol className="mt-12 grid list-none gap-px overflow-hidden rounded-xl border border-line bg-line p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.t} className="bg-panel p-6">
                <div className="flex items-center justify-between">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    {s.icon}
                  </svg>
                  <span className="num text-xs text-faint">0{i + 1}</span>
                </div>
                <h3 className="mt-6 text-lg font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-muted">
            The scoring is open: crowd size is{" "}
            <code className="num text-fg">k = 1 + min(in, out) × 2 × 0.25h</code>, from the
            Explorer's last 24 hours.{" "}
            <a
              className="text-accent hover:underline"
              href={`${LINKS.repo}/blob/main/docs/scoring.md`}
            >
              Read how the score works
            </a>
            .
          </p>
        </Container>
      </section>

      <BacktestSection />

      <Container className="grid gap-16 py-20 sm:py-28 lg:grid-cols-2">
        <section aria-labelledby="limits">
          <p className="eyebrow">What it can't do</p>
          <h2 id="limits" className="mt-3 text-2xl font-semibold sm:text-3xl">
            The limits, said plainly.
          </h2>
          <dl className="mt-10 space-y-7">
            {LIMITS.map((l) => (
              <div key={l.t} className="border-l-2 border-line-strong pl-5">
                <dt className="font-semibold">{l.t}</dt>
                <dd className="m-0 mt-1.5 text-muted">{l.d}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="guarantees">
          <p className="eyebrow">Guarantees</p>
          <h2 id="guarantees" className="mt-3 text-2xl font-semibold sm:text-3xl">
            What it always does.
          </h2>
          <ul className="mt-10 list-none space-y-3 p-0">
            {GUARANTEES.map(([t, d]) => (
              <li key={t}>
                <Card className="flex gap-4 p-5">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  >
                    <path
                      d="M4 10.5l4 4 8-9"
                      fill="none"
                      stroke="var(--color-good)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div>
                    <h3 className="m-0 font-semibold">{t}</h3>
                    <p className="mt-1 text-sm text-muted">{d}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </Container>

      <section aria-labelledby="built" className="border-y border-line bg-panel">
        <Container className="py-14">
          <h2 id="built" className="eyebrow m-0">
            Built on
          </h2>
          <ul className="mt-8 grid list-none gap-8 p-0 sm:grid-cols-3">
            {BUILT_ON.map(([t, d]) => (
              <li key={t}>
                <p className="m-0 text-xl font-semibold tracking-tight">{t}</p>
                <p className="mt-2 text-sm text-muted">{d}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-faint">
            Crowdline is an independent project. It is not affiliated with or endorsed by NEAR or
            the Zcash organisations.
          </p>
        </Container>
      </section>

      <Container className="py-20 sm:py-28">
        <section aria-labelledby="faq" className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2 id="faq" className="mt-3 text-2xl font-semibold sm:text-3xl">
              Questions people ask.
            </h2>
            <p className="mt-4 text-muted">
              Something else?{" "}
              <a className="text-accent hover:underline" href={`${LINKS.repo}/issues`}>
                Open an issue
              </a>
              .
            </p>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    className="num text-faint transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </Container>

      <Container>
        <Card className="flex flex-col items-start justify-between gap-6 p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <h2 className="m-0 text-2xl font-semibold">See what your next swap gives away.</h2>
            <p className="mt-2 text-muted">
              Nothing is sent until you pay the QR. The audit is free and needs no wallet.
            </p>
          </div>
          <div className="flex gap-3">
            <ButtonLink to="/app">Check a swap</ButtonLink>
            <Link
              to="/receipt"
              className="inline-flex min-h-11 items-center px-2 text-sm text-muted hover:text-fg"
            >
              Verify a receipt
            </Link>
          </div>
        </Card>
      </Container>
    </>
  );
}
