# Threat model

## Who is watching

An observer with public data only:

- the Zcash chain (transparent inputs and outputs, shielded value balances, block times),
- the NEAR Intents Explorer (every 1Click swap, with amounts once settled),
- the destination chain (the payout transaction).

They want to link a person's shielded ZEC to a payout address on another chain. Crowdline does not
defend against 1Click itself, NEAR validators, or anyone with subpoena power over them.

## What leaks, and what Crowdline does

| #   | Leak                               | Where it shows                                                                                       | Crowdline                                                                                               |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Deposit and payout listed together | Explorer record has `originChainTxHashes` and `destinationChainTxHashes` side by side in public mode | Quotes with `confidentiality: "basic"`; audit caps public-mode swaps at 10/100                          |
| 2   | Amount + timing                    | Deposit on Zcash and payout on the destination land minutes apart with nearly the same USD value     | Sizes the crowd from real Explorer data and moves the swap to a crowded amount; the rest stays shielded |
| 3   | Refund address                     | 1Click refunds ZEC to a transparent address only. A reused one links every swap that refunds there   | Generates a one-time t-address per swap, on the user's device                                           |
| 4   | Funding from a transparent address | The deposit input is a public address with history                                                   | Tells the user to pay the ZIP-321 request straight from the shielded pool                               |
| 5   | Recipient reuse                    | The payout address appears in earlier swaps                                                          | Flags it; changing it is the user's call                                                                |

## What Crowdline cannot fix

- **The deposit is transparent.** NEAR Intents only accepts ZEC at transparent addresses, so the
  amount leaving the shielded pool is public. Crowdline makes that amount common rather than unique.
- **The payout is public.** Whatever lands on Solana or Ethereum is visible there.
- **Thin markets.** If few people swap similar amounts in the same window, no rewrite creates a crowd
  that does not exist. The score says so instead of pretending.
- **Timing within a window.** Payouts follow deposits by a few minutes. Crowdline cannot add a delay
  between them without holding funds, and it does not hold funds.

## Trusting the quote

The deposit address comes from 1Click through Crowdline's server. A compromised server or proxy
could swap it for its own. Every quote carries 1Click's ed25519 signature over the request and
quote fields (built the same way as the official SDK's `verifyQuoteSignature`, against the key
`ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`). Crowdline checks it on the server, and the
browser checks it again before it shows the QR, so a server that altered the deposit address,
amounts, recipient or refund address would be caught on your device.

The signature does not cover `confidentiality`, `appFees` or `depositMode`. The app shows
`confidentiality` as its own check rather than implying the signature vouches for it.

## New surfaces

| Feature         | What the server sees                                                             | What it never sees                   |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| Saved swaps     | Nothing. The sealed blob stays in the browser's storage.                         | The passphrase, words or quote       |
| Refund recovery | The one-time address you look up, and the signed sweep it relays to lightwalletd | The recovery words or the WIF key    |
| Inbound flow    | The same as an outbound quote: amount, your t-address, your origin-chain refund  | Anything about your shielded balance |
| Timing, routes  | A dollar amount and a destination asset, as for the audit                        | Your payout address                  |

The recovery address and the sweep are already public on the Zcash chain once broadcast, but
looking them up through Crowdline tells the server that you hold that key. Use a lightwalletd and
wallet of your own if that matters to you. A saved swap is only as strong as its passphrase:
anyone with this browser profile can try to guess it offline.
