# Evidence

Mainnet runs of Crowdline, recorded as they happened. Each run folder holds the receipt
downloaded from the live app (`receipt.json`: scores, the 1Click quote with its signature, the
final status). Receipts never contain the refund phrase or key: `buildReceipt` copies from an
allow-list, and `packages/core/test/receipt.test.ts` checks it.

Nothing here is reconstructed after the fact. If a run fails or refunds, it is written up as it
happened.

## Run 01 · 0.0015 ZEC → USDC on Solana · SUCCESS

Made on the live site, https://www.crowdl.site, with live Explorer crowd data, on
Oct 27, 2026. Receipt: [`run-01/receipt.json`](run-01/receipt.json).

| Time (UTC) | Event                                                                                 | Transaction                                                                                                                           | 1Click status     | Score   |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| 23:22:34   | Audit on live data, hardened, confidential quote signed by 1Click                     | quote `d0e7a540-a794-49fb-a533-1c5a902a1e44`, signature verified                                                                      | `PENDING_DEPOSIT` | 10 → 40 |
| ~23:30     | 0.0015 ZEC paid from ZODL's shielded balance to `t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr` | Zcash: _txid to be added from ZODL_                                                                                                   | `PROCESSING`      |         |
| 23:38:20   | 1.685932 USDC paid out on Solana (quoted minimum 1.671149)                            | [`5zbufqTq…T8vsH7az`](https://solscan.io/tx/5zbufqTqQNa1HLGUGrgZgWUDMCdgkGiVjDJb8mCdPHqCqH2BimvBNar9G8m688kkVMYPmGrzq9VkUYE4T8vsH7az) | `SUCCESS`         |         |

What the receipt shows:

- **Confidential.** The request carries `confidentiality: "basic"`. Looking the deposit address up
  on 1Click's public status endpoint without a partner key returns
  `Deposit address t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr not found`, and the status that partner
  access returns lists no origin-chain hash. A public-mode swap made the same evening was visible
  through the same endpoint without a key.
- **Signed.** `verifyQuoteSignature` accepts the quote (and the copy inside the final status).
  This executed quote is also a test fixture: `packages/oneclick/test/signature.test.ts` shows that
  changing its deposit address breaks the signature.
- **Exact input, one-time refund.** 0.0015 ZEC in, `EXACT_INPUT`, refunds to
  `t1LKz8EJJyYu2TV2qKyKyyRahhy56VA9kZS`, an address made in the browser for this swap
  (`m/44'/133'/0'/0/0` of a fresh phrase). Nothing was refunded.
- **Score.** 10/100 as first described (public mode, reused refund address), 40/100 hardened.
  The amount scored almost nothing: about 0.04 Zcash deposits and 0.13 USDC-on-Solana payouts per
  hour fell within ±1% of $1.98, so the crowd was 1.02. Small swaps are rare; the app said so
  ("Thin market") before the quote.
- **Fees.** 1Click's Solana withdrawal fee (0.269691 USDC) is large next to a $1.97 swap. That is
  a cost of testing with a tiny amount, not of Crowdline.

### How the ZEC got into the shielded wallet

The ZEC for this run started as ZEC on Solana. Shortly before the swap it was bridged to the ZODL
wallet's transparent address through 1Click (public mode, Solana deposit
`34hNaDmg…pB8c3nKZ2p`, Zcash payout `afbee6dd…520ee7d382`, 23:08 → 23:10 UTC), then shielded in
ZODL. An observer can see that bridge, the shielding, and a deposit to 1Click about twenty
minutes later. That timing link is exactly what Crowdline's audit warns about, and it is
recorded here rather than left out. A real user would shield well in advance and let the funds
sit.

## Verify a run yourself

The swap was confidential, so 1Click's status endpoint only answers with a partner key. The live
app proxies it with its own key:

```bash
curl -s "https://www.crowdl.site/api/status?depositAddress=t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr" | jq '{status, swapDetails}'
```

```powershell
Invoke-RestMethod "https://www.crowdl.site/api/status?depositAddress=t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr" | ConvertTo-Json -Depth 6
```

Without a key, 1Click itself says the address is not found, which is the confidentiality working:

```bash
curl -s "https://1click.chaindefuser.com/v0/status?depositAddress=t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr"
```

- Payout on Solana:
  https://solscan.io/tx/5zbufqTqQNa1HLGUGrgZgWUDMCdgkGiVjDJb8mCdPHqCqH2BimvBNar9G8m688kkVMYPmGrzq9VkUYE4T8vsH7az
- Deposit address on Zcash:
  https://mainnet.zcashexplorer.app/address/t1ZN3CtgSe63JSfynA3jc1oTV46i3Eyz6Mr
- Signature: load `run-01/receipt.json` on https://www.crowdl.site/receipt. It checks
  1Click's ed25519 signature in your browser.
