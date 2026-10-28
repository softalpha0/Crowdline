# Roadmap

## Shipped

| #   | Feature               | Where                                                        |
| --- | --------------------- | ------------------------------------------------------------ |
| 1   | When-to-swap heatmap  | `/app` step 2, `GET /api/timing`, `crowdByHour`              |
| 2   | Route comparison      | `/app` step 2, `GET /api/routes`, `compareRoutes`            |
| 3   | Funding recency check | `/app` step 1, the `timing` finding in `auditIntent`         |
| 4   | Encrypted saved swaps | `/app` step 3, `sealSession` / `openSession`                 |
| 5   | Wallet payment guide  | `/app` step 4                                                |
| 6   | Refund recovery       | `/recover`, `ztx.buildSweep`, `/api/refund/*`                |
| 7   | Inbound flow          | `/in`, `buildInboundQuoteRequest`, `POST /api/inbound/quote` |
| 8   | Backtested score      | landing page, `GET /api/backtest`, `backtest`                |
| 9   | Shared cache          | `apps/server/src/cache.ts` (Upstash REST, Vercel KV)         |

## Next

### 10. An SDK for wallets

The audit is most useful where the swap starts: inside the wallet. `@crowdline/core` already runs
anywhere JavaScript runs and makes no network calls; the work is packaging it.

- Publish `@crowdline/core` and `@crowdline/oneclick` to npm with a stable API: `auditIntent`,
  `suggestBuckets`, `sizeCrowd`, `crowdByHour`, `verifyQuoteSignature`.
- A small hosted endpoint for wallets that cannot hold an Explorer key: send an amount and
  destination, get a crowd size back, with nothing about the user stored.
- A drop-in "check before you swap" panel for wallets that already integrate NEAR Intents.

### 11. Business model through `appFees`

1Click lets a distribution partner add its own fee to a quote (`appFees`). A small fee, shown
before the quote and recorded in the receipt, would pay for the Explorer key, hosting and audits
without accounts or tracking. The free audit stays free; only executed swaps pay.

### 12. A public linkability index

The backtest already measures, for a day of real swaps, how often amount and timing alone give a
swap away. Run it daily, publish the series, and break it down by route and amount band: a public
number for how private swaps out of Zcash are, and whether that is getting better.

### 13. Hosting fit for a privacy tool

- An onion service, so using Crowdline does not itself show up in someone's network logs.
- Reproducible builds of the web bundle, with the hash published per release, so anyone can check
  that the code running in their browser is the code in this repo.
- An IPFS mirror of each release, so the app keeps working if one host goes away.
