import { parseTransparent } from "@crowdline/core";
import { verifyQuoteSignature } from "@crowdline/oneclick";
import type { SyntheticEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Container, ErrorNote } from "../components/ui.tsx";
import type { Config, QuoteResult, StatusResult } from "../lib/api.ts";
import { TERMINAL, api, messageOf } from "../lib/api.ts";
import { short } from "../lib/format.ts";
import { shieldedAt } from "../lib/storage.ts";

/** The way in: another chain's asset to ZEC, then into the shielded pool. */
export default function Inbound() {
  const [config, setConfig] = useState<Config>();
  const [originAsset, setOriginAsset] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<QuoteResult>();
  const [status, setStatus] = useState<StatusResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Bring assets into Zcash · Crowdline";
    api.config().then(
      (c) => {
        setConfig(c);
        const first = c.destinations.find((d) => d.symbol === "USDC" && d.blockchain === "sol");
        setOriginAsset(first?.assetId ?? c.destinations[0]?.assetId ?? "");
      },
      (e: unknown) => {
        setError(messageOf(e));
      },
    );
  }, []);

  const origin = config?.destinations.find((d) => d.assetId === originAsset);
  const options = useMemo(
    () =>
      (config?.destinations ?? [])
        .slice()
        .sort(
          (a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain),
        ),
    [config],
  );

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
        if (s.status === "SUCCESS") shieldedAt.mark();
        if (TERMINAL.includes(s.status)) return;
      } catch {
        /* retry */
      }
      if (!stop) timer = window.setTimeout(() => void tick(), 10_000);
    };
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [depositAddress]);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(undefined);
    if (!parseTransparent(recipient)) {
      setError("1Click pays ZEC to transparent addresses only. Paste your wallet's t-address.");
      return;
    }
    setBusy(true);
    try {
      const q = await api.inboundQuote({ originAsset, amount, recipient, refundTo });
      if (!verifyQuoteSignature(q)) throw new Error("The quote's signature did not verify.");
      setQuote(q);
    } catch (x) {
      setError(messageOf(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <p className="eyebrow">The way in</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Bring assets into Zcash</h1>
      <p className="mt-3 text-muted">
        Swap another chain's asset into ZEC with a confidential 1Click quote. ZEC arrives at a
        transparent address of yours, so shield it as soon as it lands, then let it sit before
        swapping out again: money that goes in and out close together, in similar amounts, can be
        matched.
      </p>

      <Card className="mt-8 p-5 sm:p-8">
        {!quote ? (
          <form onSubmit={(e) => void submit(e)} className="grid gap-5 sm:grid-cols-2" noValidate>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              You send
              <select
                className="field font-normal"
                value={originAsset}
                onChange={(e) => {
                  setOriginAsset(e.target.value);
                }}
              >
                {options.map((d) => (
                  <option key={d.assetId} value={d.assetId}>
                    {d.symbol} on {d.blockchain}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Amount
              <input
                className="field num font-normal"
                inputMode="decimal"
                placeholder="25"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value.trim());
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Your Zcash transparent address
              <input
                className="field num text-sm font-normal"
                spellCheck={false}
                autoComplete="off"
                placeholder="t1… (in ZODL: Receive, then the transparent address)"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value.trim());
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Refund address on {origin?.blockchain ?? "the origin chain"}
              <input
                className="field num text-sm font-normal"
                spellCheck={false}
                autoComplete="off"
                placeholder="The wallet you pay from"
                value={refundTo}
                onChange={(e) => {
                  setRefundTo(e.target.value.trim());
                }}
              />
            </label>
            <div className="flex flex-col gap-3 sm:col-span-2">
              {config && !config.quotes && (
                <ErrorNote>This server cannot request quotes right now.</ErrorNote>
              )}
              <ErrorNote>{error}</ErrorNote>
              <div>
                <Button
                  type="submit"
                  disabled={busy || !config?.quotes || !amount}
                  aria-busy={busy}
                >
                  {busy ? "Asking 1Click…" : "Get a confidential quote"}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div aria-live="polite">
            <span className="num inline-flex rounded-full border border-good/40 px-2.5 py-1 text-xs text-good">
              ✓ Signed by 1Click
            </span>
            <dl className="num mt-4 grid gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="text-muted">Send exactly</dt>
              <dd className="m-0 font-semibold">
                {quote.quote.amountInFormatted} {origin?.symbol}
              </dd>
              <dt className="text-muted">To</dt>
              <dd className="m-0 break-all">{quote.quote.depositAddress}</dd>
              <dt className="text-muted">You get</dt>
              <dd className="m-0">≈ {quote.quote.amountOutFormatted} ZEC</dd>
            </dl>
            <p className="mt-4 text-sm text-muted">
              Send from your {origin?.blockchain} wallet with its ordinary Send. Status:{" "}
              <strong className="text-fg">{status?.status.replace(/_/g, " ") ?? "waiting"}</strong>
              {status?.swapDetails.destinationChainTxHashes[0] && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    className="text-accent hover:underline"
                    href={status.swapDetails.destinationChainTxHashes[0].explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(status.swapDetails.destinationChainTxHashes[0].hash, 8, 6)}
                  </a>
                </>
              )}
            </p>
            {status?.status === "SUCCESS" && (
              <div className="mt-4 rounded-lg border border-good/40 bg-good/5 px-3 py-3 text-sm">
                <p className="m-0 text-good">ZEC delivered to your transparent address.</p>
                <ol className="mt-2 mb-0 space-y-1 pl-5 text-muted">
                  <li>Shield it in your wallet now (ZODL shows a Shield button).</li>
                  <li>
                    Wait at least a day before swapping out. When you do,{" "}
                    <Link className="text-accent hover:underline" to="/app">
                      check the swap
                    </Link>
                    : Crowdline remembers when this arrived.
                  </li>
                </ol>
              </div>
            )}
          </div>
        )}
      </Card>
    </Container>
  );
}
