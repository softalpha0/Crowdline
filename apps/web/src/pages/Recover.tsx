import { formatZec, parseTransparent, refundFromMnemonic, ztx } from "@crowdline/core";
import { useEffect, useState } from "react";
import { Button, Card, Container, ErrorNote } from "../components/ui.tsx";
import type { RefundCoins } from "../lib/api.ts";
import { api, messageOf } from "../lib/api.ts";
import { short } from "../lib/format.ts";

interface Key {
  address: string;
  wif: string;
}

/** Words or a WIF key, turned into the address and key they control. Local only. */
function keyFrom(input: string): Key {
  const t = input.trim().replace(/\s+/g, " ");
  if (t.includes(" ")) {
    const r = refundFromMnemonic(t.toLowerCase(), "mainnet");
    return { address: r.address, wif: r.wif };
  }
  return { address: ztx.addressFromWif(t), wif: t };
}

const coinsOf = (c: RefundCoins): ztx.Utxo[] =>
  c.coins.map((x) => ({
    txid: x.txid,
    index: x.index,
    value: BigInt(x.value),
    script: ztx.hex.from(x.script),
  }));

export default function Recover() {
  const [secret, setSecret] = useState("");
  const [key, setKey] = useState<Key>();
  const [coins, setCoins] = useState<RefundCoins>();
  const [to, setTo] = useState("");
  const [plan, setPlan] = useState<ztx.SweepPlan>();
  const [sent, setSent] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Recover a refund · Crowdline";
  }, []);

  const total = coins ? coinsOf(coins).reduce((n, c) => n + c.value, 0n) : 0n;

  async function find() {
    setError(undefined);
    setCoins(undefined);
    setPlan(undefined);
    let k: Key;
    try {
      k = keyFrom(secret);
    } catch {
      setError("Those are not valid recovery words or a mainnet WIF key.");
      return;
    }
    setKey(k);
    setBusy(true);
    try {
      setCoins(await api.refundCoins(k.address));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function build() {
    setError(undefined);
    if (!key || !coins) return;
    if (parseTransparent(to)?.network !== "mainnet") {
      setError("Enter a mainnet transparent address (t1…) to send the refund to.");
      return;
    }
    try {
      setPlan(
        ztx.buildSweep({
          coins: coinsOf(coins),
          wif: key.wif,
          to,
          branchId: coins.branchId,
          height: coins.height,
        }),
      );
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function broadcast() {
    if (!plan) return;
    setBusy(true);
    setError(undefined);
    try {
      setSent((await api.broadcast(plan.raw)).txid);
      setSecret("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="max-w-3xl py-10 sm:py-14">
      <p className="eyebrow">Refund recovery</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
        Move a refund off its one-time address
      </h1>
      <p className="mt-3 text-muted">
        If 1Click refunded a swap, the ZEC sits at the one-time address Crowdline made for it. Paste
        the recovery words or the WIF key from that swap. The key stays in this tab: the transaction
        is built and signed here, and the server only relays the signed result.
      </p>
      <p className="mt-2 text-sm text-faint">
        The signing code reproduces real mainnet transactions byte for byte and verifies their
        signatures. A live sweep through this page has not been run yet, so start with a small
        refund.
      </p>

      <Card className="mt-8 p-5 sm:p-8">
        <label htmlFor="secret" className="text-sm font-medium">
          Recovery words or WIF key
        </label>
        <textarea
          id="secret"
          className="field num mt-2 min-h-24 text-sm"
          autoComplete="off"
          spellCheck={false}
          placeholder="24 words, or a key starting with K or L"
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            setKey(undefined);
            setCoins(undefined);
            setPlan(undefined);
          }}
        />
        <div className="mt-4">
          <Button onClick={() => void find()} disabled={busy || !secret.trim()} aria-busy={busy}>
            {busy && !coins ? "Looking…" : "Find the refund"}
          </Button>
        </div>

        {key && coins && (
          <div className="mt-8 border-t border-line pt-6" aria-live="polite">
            <p className="m-0 text-sm text-muted">
              <span className="num text-fg">{short(key.address, 10, 8)}</span> holds{" "}
              <strong className="num text-fg">{formatZec(total)} ZEC</strong> in{" "}
              {coins.coins.length} {coins.coins.length === 1 ? "coin" : "coins"} at block{" "}
              <span className="num">{coins.height.toLocaleString("en-US")}</span>.
            </p>
            {coins.coins.length > 0 && !sent && (
              <>
                <label htmlFor="to" className="mt-6 block text-sm font-medium">
                  Send it to
                </label>
                <input
                  id="to"
                  className="field num mt-2 text-sm"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="t1… (your wallet's transparent receive address)"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value.trim());
                    setPlan(undefined);
                  }}
                />
                <p className="mt-1 text-xs text-faint">
                  Transparent only for now. Shield it in your wallet once it arrives.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={build} disabled={!to}>
                    Build and sign here
                  </Button>
                  {plan && (
                    <Button onClick={() => void broadcast()} disabled={busy} aria-busy={busy}>
                      {busy ? "Sending…" : `Send ${formatZec(plan.amount)} ZEC`}
                    </Button>
                  )}
                </div>
                {plan && (
                  <dl className="num mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
                    <dt className="text-muted">Amount</dt>
                    <dd className="m-0">{formatZec(plan.amount)} ZEC</dd>
                    <dt className="text-muted">Network fee</dt>
                    <dd className="m-0">{formatZec(plan.fee)} ZEC (ZIP 317)</dd>
                    <dt className="text-muted">Transaction</dt>
                    <dd className="m-0 break-all">{plan.txid}</dd>
                  </dl>
                )}
              </>
            )}
          </div>
        )}

        {sent && (
          <p className="mt-6 rounded-lg border border-good/40 bg-good/5 px-3 py-2 text-sm text-good">
            Sent. Transaction{" "}
            <a
              className="num underline"
              href={`https://blockchair.com/zcash/transaction/${sent}`}
              target="_blank"
              rel="noreferrer"
            >
              {short(sent, 10, 8)}
            </a>{" "}
            should confirm within a few blocks.
          </p>
        )}
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </Card>
    </Container>
  );
}
