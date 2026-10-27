import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

export function Container({ className = "", ...p }: ComponentProps<"div">) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`} {...p} />;
}

/** Five ticks, one offset: you, among swaps that look like yours. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#4a4f5a" strokeWidth="2" strokeLinecap="round">
        <path d="M3 6v12M7.5 6v12M16.5 6v12M21 6v12" />
      </g>
      <path d="M12 3v12" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <Mark />
      <span className="text-[17px]">Crowdline</span>
    </span>
  );
}

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants = {
  primary: "bg-accent text-accent-ink hover:bg-[#b3bcff]",
  secondary: "border border-line-strong text-fg hover:border-[#4a505c] hover:bg-raised",
  ghost: "text-muted hover:text-fg",
};
type Variant = keyof typeof variants;

export function Button({
  variant = "primary",
  className = "",
  ...p
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...p} />;
}

export function ButtonLink({
  to,
  variant = "primary",
  className = "",
  children,
}: {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  const cls = `${base} ${variants[variant]} ${className}`;
  return /^https?:/.test(to) ? (
    <a href={to} className={cls} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {children}
    </Link>
  );
}

export function ModeBadge({ mode }: { mode?: "live" | "demo" }) {
  if (!mode) return <span className="skeleton inline-block h-6 w-14" aria-hidden="true" />;
  const live = mode === "live";
  return (
    <span
      className={`num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs uppercase tracking-wider ${
        live ? "border-good/40 text-good" : "border-warn/40 text-warn"
      }`}
      title={
        live
          ? "Computed from the NEAR Intents Explorer API"
          : "No Explorer key on this server: synthetic flows, not real swaps"
      }
    >
      <span
        className={`size-1.5 rounded-full ${live ? "bg-good" : "bg-warn"}`}
        aria-hidden="true"
      />
      {live ? "Live" : "Demo"}
    </span>
  );
}

const TONE = { bad: "var(--color-bad)", warn: "var(--color-warn)", good: "var(--color-good)" };

export function ScoreDial({
  score,
  tone,
  size = 120,
  label,
}: {
  score: number;
  tone: keyof typeof TONE;
  size?: number;
  label?: string;
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={TONE[tone]}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * c} ${c}`}
            transform="rotate(-90 50 50)"
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-semibold" style={{ fontSize: size * 0.3, lineHeight: 1 }}>
            {score}
          </span>
          <span className="num text-xs text-faint">/100</span>
        </div>
      </div>
      {label && <figcaption className="text-sm text-muted">{label}</figcaption>}
    </figure>
  );
}

export function Card({ className = "", ...p }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-line bg-panel ${className}`} {...p} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">
      {children}
    </p>
  );
}
