import type { Receipt as ReceiptData } from "@crowdline/core";
import { parseReceipt } from "@crowdline/core";
import { verifyQuoteSignature } from "@crowdline/oneclick";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { Button, Card, Container, ErrorNote, ModeBadge, ScoreDial } from "../components/ui.tsx";
import type { QuoteResult, StatusResult } from "../lib/api.ts";
import { api, confidentialityOf } from "../lib/api.ts";
import { crowdLabel, scoreTone, short } from "../lib/format.ts";

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{k}</dt>
      <dd className="num m-0 min-w-0 text-sm break-all">{children}</dd>
    </div>
  );
}

function View({ r }: { r: ReceiptData }) {
  const quote = r.quote as QuoteResult | undefined;
  const signed = quote ? verifyQuoteSignature(quote) : false;
  const [status, setStatus] = useState<StatusResult | undefined>(
    r.status as StatusResult | undefined,
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const conf = quote ? confidentialityOf(quote) : undefined;
  const deposit = quote?.quote.depositAddress;
  const txs = status
    ? [
        ...status.swapDetails.originChainTxHashes.map((t) => ["Zcash deposit", t] as const),
        ...status.swapDetails.destinationChainTxHashes.map((t) => ["Payout", t] as const),
      ]
    : [];

  return (
    <div className="mt-8 flex flex-col gap-5">
      <Card className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          {quote ? (
            <span
              className={`num rounded-full border px-2.5 py-1 text-xs ${signed ? "border-good/40 text-good" : "border-bad/40 text-bad"}`}
            >
              {signed ? "✓ Signed by 1Click" : "✗ Signature does not verify"}
            </span>
          ) : (
            <span className="num rounded-full border border-line-strong px-2.5 py-1 text-xs text-muted">
              No quote in this receipt
            </span>
          )}
          {conf && (
            <span
              className={`num rounded-full border px-2.5 py-1 text-xs ${conf === "public" ? "border-bad/40 text-bad" : "border-good/40 text-good"}`}
            >
              Confidentiality: {conf}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted">
            Crowd data <ModeBadge mode={r.crowdData} />
          </span>
        </div>
        {quote && !signed && (
          <p className="mt-4 text-sm text-bad">
            The quote in this file was changed after 1Click signed it, or it was never signed. Do
            not trust its deposit address or amounts.
          </p>
        )}
        {r.before && r.after && (
          <div className="mt-8 flex items-center justify-center gap-4 sm:gap-14">
            <ScoreDial score={r.before.score} tone={scoreTone(r.before.score)} label="Before" />
            <span className="text-xl text-faint" aria-hidden="true">
              →
            </span>
            <ScoreDial score={r.after.score} tone={scoreTone(r.after.score)} label="After" />
          </div>
        )}
        {r.before && r.after && (
          <p className="mt-3 text-center text-xs text-faint">
            ≈{crowdLabel(r.before.crowd.k)} → ≈{crowdLabel(r.after.crowd.k)} look-alike swaps
          </p>
        )}
      </Card>

      <Card className="p-5 sm:p-8">
        <h2 className="m-0 text-lg font-semibold">Swap</h2>
        <dl className="m-0 mt-4">
          <Row k="Created">{new Date(r.createdAt).toLocaleString()}</Row>
          {r.chosenAmountZec && <Row k="Sent">{r.chosenAmountZec} ZEC</Row>}
          {quote && (
            <Row k="Quoted payout">
              {quote.quote.amountOutFormatted} (${Number(quote.quote.amountOutUsd).toFixed(2)}), min{" "}
              {quote.quote.minAmountOut}
            </Row>
          )}
          {deposit && <Row k="Deposit address">{deposit}</Row>}
          {quote && <Row k="Recipient">{String(quote.quoteRequest.recipient)}</Row>}
          {r.refundAddress && (
            <Row k="Refund address">
              {r.refundAddress}
              {r.refundPath && <span className="text-faint"> · {r.refundPath}</span>}
            </Row>
          )}
          {quote && <Row k="1Click quote time">{quote.timestamp}</Row>}
          {quote && <Row k="Signature">{short(quote.signature, 18, 10)}</Row>}
        </dl>
      </Card>

      <Card className="p-5 sm:p-8" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-semibold">Status</h2>
          {deposit && (
            <Button
              variant="secondary"
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setError(undefined);
                try {
                  setStatus(await api.status(deposit));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? "Checking…" : "Check live status"}
            </Button>
          )}
        </div>
        {status ? (
          <>
            <p className="mt-3 mb-0 font-medium">
              {status.status.replace(/_/g, " ")}
              <span className="num ml-2 text-xs font-normal text-faint">
                {new Date(status.updatedAt).toLocaleString()}
              </span>
            </p>
            {txs.length > 0 && (
              <ul className="num mt-3 list-none space-y-1 p-0 text-sm">
                {txs.map(([label, t]) => (
                  <li key={t.hash}>
                    <span className="text-muted">{label}: </span>
                    <a
                      className="text-accent hover:underline"
                      href={t.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {short(t.hash, 12, 10)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {status.swapDetails.refundReason && (
              <p className="mt-2 text-sm text-warn">
                Refund reason: {status.swapDetails.refundReason}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">
            This receipt was saved before any status came back.
          </p>
        )}
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </Card>
    </div>
  );
}

export default function Receipt() {
  const [text, setText] = useState("");
  const [receipt, setReceipt] = useState<ReceiptData>();
  const [error, setError] = useState<string>();
  const inputId = useId();
  const fileId = useId();

  useEffect(() => {
    document.title = "Verify a receipt · Crowdline";
  }, []);

  function load(t: string) {
    setError(undefined);
    setReceipt(undefined);
    try {
      setReceipt(parseReceipt(t));
    } catch (e) {
      setError(e instanceof SyntaxError ? "That is not valid JSON." : (e as Error).message);
    }
  }

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <p className="eyebrow">Receipts</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Verify a receipt</h1>
      <p className="mt-3 text-muted">
        Paste or upload a receipt downloaded from Crowdline. The 1Click signature is checked here in
        your browser against 1Click's public key. Nothing is uploaded.
      </p>
      <Card className="mt-8 p-5 sm:p-6">
        <label htmlFor={inputId} className="text-sm font-medium">
          Receipt JSON
        </label>
        <textarea
          id={inputId}
          className="field num mt-2 min-h-40 text-xs"
          spellCheck={false}
          placeholder='{"app": "crowdline", …}'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              load(text);
            }}
            disabled={!text.trim()}
          >
            Verify
          </Button>
          <label
            htmlFor={fileId}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-strong px-4 text-sm hover:bg-raised focus-within:outline-2 focus-within:outline-accent"
          >
            Upload a file
            <input
              id={fileId}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const t = await f.text();
                setText(t);
                load(t);
              }}
            />
          </label>
        </div>
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </Card>
      {receipt ? (
        <View r={receipt} />
      ) : (
        !error && <p className="mt-8 text-center text-sm text-faint">No receipt loaded yet.</p>
      )}
    </Container>
  );
}
