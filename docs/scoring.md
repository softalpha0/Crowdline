# How the score works

All of it lives in [`packages/core/src`](../packages/core/src) and is covered by tests.

## Crowd size

For a swap worth `usd` dollars going to `destinationAsset`, over the last 24 hours:

- `inRate` = Zcash-origin swaps per hour with `amountInUsd` within ±1% of `usd`
- `outRate` = swaps per hour paying out `destinationAsset` with `amountOutUsd` within ±1% of `usd`

An observer searching ±15 minutes around your swap expects to find

```
k = 1 + min(inRate, outRate) × 2 × 0.25
```

swaps that look like yours, you included. You are only as hidden as the thinner of the two crowds.
`bits = log2(k)`.

Swaps still in flight are excluded: the Explorer reports their amounts as 0.

## Amount buckets

Candidate amounts at or below what you typed, down to 30% less:

1. the amount as typed,
2. exact ZEC amounts other people swapped at least twice in the window ("common amount"),
3. round numbers with one or two significant figures.

Each is sized with the formula above. The biggest crowd wins; ties keep back as little as possible.
Crowdline never suggests sending more than you asked.

## Score (0 to 100)

| Part                             | Points                                         |
| -------------------------------- | ---------------------------------------------- |
| Amount crowd                     | `60 × min(1, bits / 5)` (full marks at k ≥ 32) |
| One-time refund address          | 15                                             |
| Deposit paid from shielded funds | 15 (fresh transparent: 7, reused: 0)           |
| Recipient with no swap history   | 10                                             |

A public-mode swap is capped at 10, because the Explorer already links both ends.

## Severity of the amount finding

| bits  | k    | severity |
| ----- | ---- | -------- |
| < 1   | < 2  | critical |
| < 2   | < 4  | high     |
| < 3.5 | < 11 | medium   |
| < 5   | < 32 | low      |
| ≥ 5   | ≥ 32 | ok       |
