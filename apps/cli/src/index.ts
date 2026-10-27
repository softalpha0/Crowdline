#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";
import type { Confidentiality, Flow, FundingSource, RefundMode, Report } from "@crowdline/core";
import {
  DEMO_DESTINATIONS,
  DEMO_ZEC_ASSET,
  auditIntent,
  dedupeFlows,
  demoFlows,
  flowsFromExplorer,
  newOneTimeRefund,
  suggestBuckets,
} from "@crowdline/core";
import type { Token } from "@crowdline/oneclick";
import { Explorer, OneClick, findZec } from "@crowdline/oneclick";

const HELP = `crowdline — check what a shielded ZEC swap leaks before it leaves Zcash

Usage
  crowdline audit --amount <ZEC> --to <SYMBOL:chain | assetId> --recipient <address> [options]
  crowdline refund [--testnet]

Audit options
  --mode public|basic         swap visibility you'd use today          (default public)
  --funding shielded|transparent-fresh|transparent-reused             (default shielded)
  --refund reused|one-time    where refunds would go                    (default reused)
  --refund-to <t1…>           your usual refund address, checked against history
  --demo                      use synthetic flows instead of the Explorer API
  --json                      print the raw report

Live crowd data needs EXPLORER_JWT (partners.near-intents.org).`;

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", d: "", b: "", x: "" };

function resolveDestination(tokens: Token[], to: string): Token {
  const exact = tokens.find((t) => t.assetId === to);
  if (exact) return exact;
  const [sym, chain] = to.split(":");
  const hit = tokens.find(
    (t) => t.symbol.toUpperCase() === sym?.toUpperCase() && t.blockchain === chain?.toLowerCase(),
  );
  if (!hit) throw new Error(`Unknown destination "${to}". Try USDC:sol or a full assetId.`);
  return hit;
}

function line(report: Report, label: string): string {
  const colour = report.score >= 70 ? C.g : report.score >= 35 ? C.y : C.r;
  return `${C.b}${label.padEnd(18)}${C.x}${colour}${String(report.score).padStart(3)}/100${C.x}  ${C.d}≈${Math.max(1, Math.round(report.crowd.k))} look-alike swaps, ${report.crowd.bits.toFixed(1)} bits${C.x}`;
}

async function audit(v: Record<string, string | boolean | undefined>): Promise<void> {
  const amount = String(v.amount ?? "");
  const to = String(v.to ?? "");
  if (!amount || !to) throw new Error("--amount and --to are required");

  const demo = Boolean(v.demo) || !process.env.EXPLORER_JWT;
  const oneclick = new OneClick({ apiKey: process.env.ONECLICK_API_KEY });
  let tokens: Token[];
  try {
    tokens = await oneclick.tokens();
  } catch (e) {
    if (!demo) throw e;
    tokens = [
      { assetId: DEMO_ZEC_ASSET, decimals: 8, blockchain: "zec", symbol: "ZEC", price: 300 },
      { assetId: DEMO_DESTINATIONS[0], decimals: 6, blockchain: "sol", symbol: "USDC", price: 1 },
    ];
  }
  const zec = findZec(tokens);
  const dest = resolveDestination(tokens, to);
  const now = Math.floor(Date.now() / 1000);

  let flows: Flow[];
  if (demo) {
    flows = demoFlows({ now, zecUsd: zec.price }).map((f) => ({
      ...f,
      originAsset: f.originAsset === DEMO_ZEC_ASSET ? zec.assetId : f.originAsset,
      destinationAsset:
        f.destinationAsset === DEMO_DESTINATIONS[0] ? dest.assetId : f.destinationAsset,
    }));
  } else {
    const ex = new Explorer({ jwt: process.env.EXPLORER_JWT ?? "" });
    flows = dedupeFlows(flowsFromExplorer(await ex.crowdRows(dest.assetId, 24, now)));
  }

  const intent = {
    amountZec: Number(amount),
    zecUsd: zec.price,
    destinationAsset: dest.assetId,
    recipient: String(v.recipient ?? ""),
    confidentiality: (v.mode ?? "public") as Confidentiality,
    funding: (v.funding ?? "shielded") as FundingSource,
    refund: (v.refund ?? "reused") as RefundMode,
  };
  const ctx = { flows, zecAsset: zec.assetId, now };
  const before = auditIntent(intent, { ...ctx, refundTo: v["refund-to"] as string | undefined });
  const buckets = suggestBuckets(flows, {
    amountZec: amount,
    zecUsd: zec.price,
    zecAsset: zec.assetId,
    destinationAsset: dest.assetId,
    now,
  });
  const best = buckets[0];
  const after = auditIntent(
    {
      ...intent,
      amountZec: best ? Number(best.amountZec) : intent.amountZec,
      confidentiality: "basic",
      funding: "shielded",
      refund: "one-time",
    },
    ctx,
  );

  if (v.json) {
    console.log(
      JSON.stringify({ demo, flowsChecked: flows.length, before, buckets, after }, null, 2),
    );
    return;
  }

  console.log(
    `\n${C.b}${amount} ZEC → ${dest.symbol} on ${dest.blockchain}${C.x}  ${C.d}(${flows.length} swaps checked, ${demo ? "DEMO data" : "live Explorer data"}, ZEC $${zec.price})${C.x}\n`,
  );
  console.log(line(before, "As you'd send it"));
  console.log(line(after, "With Crowdline"));
  console.log(`\n${C.b}Leaks${C.x}`);
  for (const f of before.findings.filter((f) => f.severity !== "ok")) {
    const col = f.severity === "critical" || f.severity === "high" ? C.r : C.y;
    console.log(`  ${col}${f.severity.toUpperCase().padEnd(9)}${C.x}${f.title}`);
    if (f.fix) console.log(`  ${" ".repeat(9)}${C.d}→ ${f.fix}${C.x}`);
  }
  console.log(`\n${C.b}Crowded amounts${C.x}`);
  for (const b of buckets) {
    console.log(
      `  ${b.amountZec.padEnd(12)} ZEC  ${C.g}${String(Math.max(1, Math.round(b.crowd.k))).padStart(4)}×${C.x}  ${C.d}${b.holdBackZec === "0" ? "send all" : `keep ${b.holdBackZec} shielded`}${C.x}`,
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--")),
    allowPositionals: true,
    options: {
      amount: { type: "string" },
      to: { type: "string" },
      recipient: { type: "string" },
      mode: { type: "string" },
      funding: { type: "string" },
      refund: { type: "string" },
      "refund-to": { type: "string" },
      demo: { type: "boolean" },
      json: { type: "boolean" },
      testnet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd) {
    console.log(HELP);
    return;
  }
  if (cmd === "audit") return audit(values);
  if (cmd === "refund") {
    const r = newOneTimeRefund(values.testnet ? "testnet" : "mainnet");
    console.log(
      JSON.stringify(
        { address: r.address, path: r.path, mnemonic: r.mnemonic, wif: r.wif },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Unknown command "${cmd}"\n\n${HELP}`);
}

main().catch((e: unknown) => {
  console.error(`${C.r}error${C.x} ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
