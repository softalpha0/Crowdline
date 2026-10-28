import { useState } from "react";

interface Guide {
  id: string;
  name: string;
  steps: string[];
  warning?: string;
}

/**
 * How to pay the deposit from each wallet's shielded balance. The ZODL steps
 * follow the first mainnet run; the others stay generic on purpose.
 */
const GUIDES: Guide[] = [
  {
    id: "zodl",
    name: "ZODL",
    steps: [
      "Open ZODL and tap Send (not Swap or CrossPay).",
      "Tap the scan icon and scan the QR, or paste the address and the exact amount.",
      "Check that the amount matches to the last digit, then confirm.",
      "ZODL spends from your shielded balance. There is no need to move funds first.",
    ],
    warning:
      "CrossPay and Swap inside ZODL start their own NEAR Intents swap with their own refund address, which skips Crowdline's quote and one-time refund.",
  },
  {
    id: "zingo",
    name: "Zingo",
    steps: [
      "Open Zingo and go to Send.",
      "Scan the QR, or paste the address and the exact amount.",
      "Check that the amount matches to the last digit and that it is paid from your shielded balance, then send.",
    ],
  },
  {
    id: "zkool",
    name: "Zkool",
    steps: [
      "Open the account that holds the shielded funds and choose Send.",
      "Paste the address and the exact amount, or scan the QR on mobile.",
      "If Zkool asks which pools to spend from, choose only shielded ones, then send.",
    ],
  },
  {
    id: "other",
    name: "Other wallets",
    steps: [
      "Use your wallet's ordinary Send, not a built-in swap.",
      "Send exactly the amount shown to the t-address shown.",
      "Pay from a shielded balance. If your wallet can only spend from a t-address, the deposit links to that address's history.",
    ],
  },
];

export function WalletGuide() {
  const [tab, setTab] = useState("zodl");
  const g = GUIDES.find((x) => x.id === tab) ?? GUIDES[0];
  if (!g) return null;
  return (
    <div className="mt-6 rounded-lg border border-line bg-ink p-4">
      <p className="eyebrow m-0">How to pay it</p>
      <div role="tablist" aria-label="Wallet" className="mt-3 flex flex-wrap gap-1">
        {GUIDES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`wg-${x.id}`}
            aria-selected={x.id === tab}
            aria-controls="wg-panel"
            className={`rounded-md border px-3 py-1.5 text-sm ${
              x.id === tab
                ? "border-accent bg-accent/10 text-fg"
                : "border-line text-muted hover:text-fg"
            }`}
            onClick={() => {
              setTab(x.id);
            }}
          >
            {x.name}
          </button>
        ))}
      </div>
      <div id="wg-panel" role="tabpanel" aria-labelledby={`wg-${g.id}`} className="mt-4">
        <ol className="m-0 space-y-2 pl-5 text-sm text-muted">
          {g.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {g.warning && (
          <p className="mt-3 mb-0 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
            {g.warning}
          </p>
        )}
      </div>
    </div>
  );
}
