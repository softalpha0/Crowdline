import { useEffect, useState } from "react";
import type { Destination, Routes, Timing } from "../lib/api.ts";
import { api, messageOf } from "../lib/api.ts";
import { crowdLabel } from "../lib/format.ts";

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Hour `h` UTC in the viewer's time zone, e.g. "15:00". */
function localHour(h: number): string {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key?: string; data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    load().then(
      (data) => {
        if (live) setState({ key, data });
      },
      (e: unknown) => {
        if (live) setState({ key, error: messageOf(e) });
      },
    );
    return () => {
      live = false;
    };
    // `key` stands for the caller's dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A result for older inputs is not shown while the new one loads.
  return state.key === key ? state : {};
}

/** When are swaps like this one common? 24 cells, one per UTC hour. */
export function TimingPanel({ destinationAsset, usd }: { destinationAsset: string; usd: number }) {
  const { data, error } = useLoad(() => api.timing(destinationAsset, usd), [destinationAsset, usd]);
  return (
    <div className="rounded-lg border border-line bg-ink p-4">
      <p className="eyebrow m-0">When to swap</p>
      {error ? (
        <p className="mt-2 mb-0 text-sm text-faint">Could not load the hourly view: {error}</p>
      ) : !data ? (
        <div className="skeleton mt-3 h-16 w-full" aria-busy="true" />
      ) : (
        <TimingView t={data} />
      )}
    </div>
  );
}

function TimingView({ t }: { t: Timing }) {
  const max = Math.max(...t.hours.map((h) => h.k));
  const best = t.best[0];
  const flat = max <= 1.05;
  return (
    <>
      <p className="mt-2 mb-0 text-sm text-muted">
        {flat ? (
          <>
            No hour in the last {t.days} days had more than one swap like yours. Timing will not
            help this amount; a different amount or route might.
          </>
        ) : (
          <>
            Busiest hour for a swap this size:{" "}
            <strong className="text-fg">{pad(best ?? 0)} UTC</strong> ({localHour(best ?? 0)} your
            time), with ≈{crowdLabel(max)} look-alikes. Averaged over the last {t.days} days
            {t.mode === "demo" ? " of demo data" : ""}.
          </>
        )}
      </p>
      <ol
        className="mt-4 grid list-none grid-cols-12 gap-1 p-0 sm:grid-cols-24"
        aria-label="Crowd size by hour of day, UTC"
      >
        {t.hours.map((h) => {
          const share = flat ? 0 : (h.k - 1) / (max - 1);
          return (
            <li
              key={h.hour}
              className="num flex h-10 flex-col items-center justify-end rounded-sm border border-line text-[10px] text-faint"
              style={{
                background: `color-mix(in oklab, var(--color-accent) ${Math.round(share * 85)}%, transparent)`,
                color: share > 0.55 ? "var(--color-accent-ink)" : undefined,
              }}
              title={`${pad(h.hour)} UTC: ≈${h.k.toFixed(1)} look-alike swaps`}
            >
              <span className="sr-only">
                {pad(h.hour)} UTC: about {crowdLabel(h.k)} look-alike swaps
              </span>
              <span aria-hidden="true">{h.hour}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 mb-0 text-xs text-faint">
        Hours in UTC. Darker means a bigger crowd. Counts swaps out of Zcash only, so real crowds
        can be larger, not smaller.
      </p>
    </>
  );
}

/** The same swap, sized on the routes people actually use. */
export function RoutesPanel({
  usd,
  destinationAsset,
  destinations,
  onPick,
}: {
  usd: number;
  destinationAsset: string;
  destinations: Destination[];
  onPick: (assetId: string) => void;
}) {
  const { data, error } = useLoad(() => api.routes(usd, destinationAsset), [usd, destinationAsset]);
  return (
    <div className="rounded-lg border border-line bg-ink p-4">
      <p className="eyebrow m-0">Which route hides it best</p>
      {error ? (
        <p className="mt-2 mb-0 text-sm text-faint">Could not compare routes: {error}</p>
      ) : !data ? (
        <div className="skeleton mt-3 h-24 w-full" aria-busy="true" />
      ) : (
        <RoutesView
          r={data}
          current={destinationAsset}
          destinations={destinations}
          onPick={onPick}
        />
      )}
    </div>
  );
}

function RoutesView({
  r,
  current,
  destinations,
  onPick,
}: {
  r: Routes;
  current: string;
  destinations: Destination[];
  onPick: (assetId: string) => void;
}) {
  const label = (id: string) => {
    const d = destinations.find((x) => x.assetId === id);
    return d ? `${d.symbol} on ${d.blockchain}` : id;
  };
  const max = Math.max(...r.routes.map((x) => x.crowd.k), 1);
  const top = r.routes[0];
  return (
    <>
      <p className="mt-2 mb-0 text-sm text-muted">
        {top && top.destinationAsset !== current && top.crowd.k > 1.2
          ? `The same swap paid out as ${label(top.destinationAsset)} would hide in a bigger crowd.`
          : "Your route is as good as any of the well-used ones right now."}
      </p>
      <ul className="m-0 mt-4 list-none space-y-2 p-0">
        {r.routes.map((x) => {
          const mine = x.destinationAsset === current;
          return (
            <li key={x.destinationAsset} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={mine ? "font-medium text-fg" : "text-muted"}>
                    {label(x.destinationAsset)}
                    {mine && <span className="ml-1 text-xs text-faint">(yours)</span>}
                  </span>
                  <span className="num text-xs text-faint">{x.zecSwaps} swaps out of ZEC, 24h</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-raised">
                  <div
                    className={`h-2 rounded-full ${mine ? "bg-accent" : "bg-line-strong"}`}
                    style={{ width: `${Math.max(4, (x.crowd.k / max) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="num w-12 text-right text-sm text-good">
                  {crowdLabel(x.crowd.k)}×
                </span>
                {!mine && (
                  <button
                    type="button"
                    className="rounded-md border border-line-strong px-2 py-1 text-xs text-muted hover:text-fg"
                    onClick={() => {
                      onPick(x.destinationAsset);
                    }}
                  >
                    Use
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 mb-0 text-xs text-faint">
        Counts swaps out of Zcash only, so every route's crowd is a lower bound. A different chain
        needs a payout address on that chain.
      </p>
    </>
  );
}
