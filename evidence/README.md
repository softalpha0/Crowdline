# Evidence

Mainnet runs of Crowdline, recorded as they happened. Each run folder holds the receipt
downloaded from the app (`receipt.json`: scores, the 1Click quote with its signature, the final
status). Receipts never contain the refund phrase or key; `buildReceipt` copies from an allow-list
and `packages/core/test/receipt.test.ts` checks it.

Nothing here is reconstructed after the fact. If a run fails or refunds, it is written up as it
happened, including where the refund landed.

## Run 01

_Pending: about 0.05 ZEC to USDC on Solana, paid from ZODL's shielded balance._

| Time (UTC) | Event                     | Zcash tx | Payout tx | 1Click status   | Score |
| ---------- | ------------------------- | -------- | --------- | --------------- | ----- |
|            | Audit on live data        |          |           |                 | →     |
|            | Confidential quote signed |          |           | PENDING_DEPOSIT |       |
|            | Deposit paid from ZODL    |          |           |                 |       |
|            | Payout                    |          |           |                 |       |

## Verify a run yourself

Replace `<DEPOSIT_ADDRESS>` with the `depositAddress` from the run's `receipt.json`.

**bash**

```bash
curl -s "https://1click.chaindefuser.com/v0/status?depositAddress=<DEPOSIT_ADDRESS>" | jq .
```

**PowerShell**

```powershell
Invoke-RestMethod "https://1click.chaindefuser.com/v0/status?depositAddress=<DEPOSIT_ADDRESS>" | ConvertTo-Json -Depth 6
```

The response lists `originChainTxHashes` (the Zcash deposit) and `destinationChainTxHashes` (the
payout), each with an explorer link. To re-check the quote signature, load `receipt.json` on the
app's `/receipt` page; it verifies against 1Click's public key in your browser.
