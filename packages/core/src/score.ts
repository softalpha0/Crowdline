import { recipientHistory, refundHistory, sizeCrowd } from "./crowd.ts";
import type { CrowdOptions, Finding, Flow, Report, Severity, SwapIntent } from "./types.ts";
import { DEFAULT_CROWD } from "./types.ts";

export interface AuditContext {
  flows: Flow[];
  zecAsset: string;
  /** Refund address the swap will use, if already known. Checked against history. */
  refundTo?: string;
  now?: number;
  crowd?: Partial<CrowdOptions>;
}

/** Bits of crowd at which the amount stops being the weak point (k = 32). */
const FULL_CROWD_BITS = 5;

function amountSeverity(bits: number): Severity {
  if (bits < 1) return "critical";
  if (bits < 2) return "high";
  if (bits < 3.5) return "medium";
  if (bits < FULL_CROWD_BITS) return "low";
  return "ok";
}

function others(k: number, windowHours: number): string {
  const n = k - 1;
  const span = `±${Math.round(windowHours * 60)} min`;
  if (n < 0.5)
    return `Searching ${span} around yours, an observer most likely finds no other swap like it.`;
  return `Searching ${span} around yours, an observer finds about ${n.toFixed(1)} others.`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Audit a swap intent before it is sent: what could someone watching Zcash,
 * NEAR Intents and the destination chain learn, and what would fix it.
 *
 * Score weights (out of 100):
 *   amount crowd 60 · refund isolation 15 · funding source 15 · fresh recipient 10.
 * A public-mode swap is capped at 10: the Explorer publishes both ends of it
 * in one record, so nothing else matters.
 */
export function auditIntent(intent: SwapIntent, ctx: AuditContext): Report {
  const usd = intent.amountZec * intent.zecUsd;
  const co = { ...DEFAULT_CROWD, ...ctx.crowd };
  const crowd = sizeCrowd(
    ctx.flows,
    { usd, zecAsset: ctx.zecAsset, destinationAsset: intent.destinationAsset, now: ctx.now },
    ctx.crowd,
  );
  const findings: Finding[] = [];

  // 1. The ledger itself.
  if (intent.confidentiality === "public") {
    findings.push({
      id: "ledger-link",
      severity: "critical",
      title: "The swap publishes both ends",
      detail:
        "In public mode the NEAR Intents Explorer lists your Zcash deposit and your payout in the same record. Nobody has to guess.",
      fix: "Request the quote with confidentiality set to basic.",
    });
  } else {
    findings.push({
      id: "ledger-link",
      severity: "ok",
      title: `Confidential Intents (${intent.confidentiality})`,
      detail:
        "Deposit and payout are not linked in the NEAR Intents record. An observer has to match them by amount and time instead.",
    });
  }

  // 2. Amount and timing.
  const sev = amountSeverity(crowd.bits);
  findings.push({
    id: "amount",
    severity: sev,
    title:
      crowd.k < 1.5 ? "Your amount is unique" : `You hide among about ${Math.round(crowd.k)} swaps`,
    detail: `About ${crowd.inPerHour.toFixed(1)} Zcash deposits and ${crowd.outPerHour.toFixed(1)} payouts per hour fall inside ±${(co.band * 100).toFixed(0)}% of $${usd.toFixed(2)}. ${others(crowd.k, co.windowHours)} Your payout lands minutes after your deposit, so amount is what links them.`,
    fix: sev === "ok" ? undefined : "Send a crowded amount instead and keep the rest shielded.",
  });

  // 3. Refund address.
  const refundUses = ctx.refundTo ? refundHistory(ctx.flows, ctx.refundTo) : 0;
  if (intent.refund === "reused") {
    findings.push({
      id: "refund",
      severity: "high",
      title: "Refunds go to an address you use",
      detail:
        "Leftover input and failed swaps are refunded transparently. Matching the refund's amount and time to the swap reveals the address, and every other swap that refunds there." +
        (refundUses > 0
          ? ` This address already received refunds in ${plural(refundUses, "past swap", "past swaps")}.`
          : ""),
      fix: "Use a one-time refund address for this swap only.",
    });
  } else {
    findings.push({
      id: "refund",
      severity: "ok",
      title: "One-time refund address",
      detail: "A refund would land on an address used for nothing else.",
    });
  }

  // 4. Funding source.
  const funding: Record<SwapIntent["funding"], Finding> = {
    shielded: {
      id: "funding",
      severity: "ok",
      title: "Funded straight from the shielded pool",
      detail:
        "The deposit comes from a shielded note. The amount leaving the pool is public; who sent it is not.",
    },
    "transparent-fresh": {
      id: "funding",
      severity: "medium",
      title: "Funded from a transparent address",
      detail:
        "The deposit's input is a public address. If it was filled by unshielding, that unshield is one hop away.",
      fix: "Pay the deposit directly from your shielded balance.",
    },
    "transparent-reused": {
      id: "funding",
      severity: "high",
      title: "Funded from a transparent address with history",
      detail: "Anyone can read that address's past and future, and now this swap joins it.",
      fix: "Pay the deposit directly from your shielded balance.",
    },
  };
  findings.push(funding[intent.funding]);

  // 5. Recipient history.
  const seen = recipientHistory(ctx.flows, intent.recipient);
  findings.push(
    seen > 0
      ? {
          id: "recipient",
          severity: "medium",
          title: "Recipient has been paid before",
          detail: `This address appears in ${plural(seen, "earlier swap", "earlier swaps")}. A fresh payout address keeps this swap from joining that history.`,
          fix: "Receive at an address you have not used with NEAR Intents.",
        }
      : {
          id: "recipient",
          severity: "ok",
          title: "Fresh recipient",
          detail: "This payout address has no NEAR Intents history in the data checked.",
        },
  );

  let score =
    60 * Math.min(1, crowd.bits / FULL_CROWD_BITS) +
    (intent.refund === "one-time" ? 15 : 0) +
    { shielded: 15, "transparent-fresh": 7, "transparent-reused": 0 }[intent.funding] +
    (seen > 0 ? 0 : 10);
  if (intent.confidentiality === "public") score = Math.min(score, 10);

  return { intent, crowd, score: Math.round(score), findings };
}
