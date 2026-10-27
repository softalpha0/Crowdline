# Zecathon submission: Crowdline

## The form

| Field           | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Project name    | Crowdline                                                      |
| Track           | Cross-chain                                                    |
| Code repository | https://github.com/softalpha0/crowdline                        |
| Working demo    | _live URL, added after deploy_                                 |
| Demo video      | _added after recording (two minutes, per the submission form)_ |
| Public repo     | Public by Oct 28, 2026 (the form's required checkbox)          |

**One-liner:** Check what your shielded ZEC swap leaks before it leaves Zcash, then fix it.

## Why it fits the track

The track asks for "swaps, bridges and intents that reach other chains without unshielding on the
way through." A swap out of Zcash through NEAR Intents is exactly that kind of intent, and today
it usually leaks on the way through: a public swap record, a unique amount, a reused transparent
refund address, a transparent funding hop. Crowdline keeps the ZEC in the shielded pool until the
moment it pays the deposit (straight from Orchard, no unshield to a t-address of your own), and
rewrites the intent so the parts NEAR Intents forces into the open (a transparent deposit address,
a transparent refund address) reveal as little as possible.

## Description (for the form's Description field, about 150 words)

> Crowdline checks what a shielded ZEC swap through NEAR Intents leaks before it leaves Zcash,
> then fixes it. Four public facts link these swaps to people: the Explorer's public swap record,
> a unique amount, a reused transparent refund address, and transparent funding. Crowdline reads
> the last 24 hours of finished swaps from the NEAR Intents Explorer, counts how many look like
> yours, and scores the swap out of 100. It then suggests a crowded amount (never more than you
> typed; the rest stays shielded), makes a one-time refund address in your browser, requests a
> 1Click quote with Confidential Intents and exact input, verifies 1Click's ed25519 signature,
> and shows a ZIP-321 QR you pay from your shielded balance in ZODL. It never holds funds and
> never sees your keys. Real: live Explorer data, real confidential quotes, signature checks, a
> mainnet run in evidence/. Not hidden: the ZEC deposit is still transparent, because NEAR only
> accepts t-addresses; Crowdline makes its amount common, not invisible. Thin markets give small
> crowds, and the score says so.

That is 172 words and 1,063 characters, under the form's 2,000-character limit. It answers the
form's prompt in order: what it does, why it does not leak, what is real and what is not.

## Short description (about 50 words)

> Crowdline audits a shielded ZEC swap through NEAR Intents before it is sent: it measures how many
> recent swaps look like yours, then rewrites the intent with a crowded amount, a confidential
> 1Click quote, a one-time refund key made on your device and a ZIP-321 payment from your
> shielded balance.

## Links

- Repo: https://github.com/softalpha0/crowdline
- Live app: _after deploy_
- Video: _after recording_
- Evidence: https://github.com/softalpha0/crowdline/tree/main/evidence

## How it uses Zcash

- **ZIP-321** payment requests for the 1Click deposit, with no memo (ZIP-321 forbids memos on
  transparent recipients), shown as a QR that ZODL, Zingo or Zkool pays.
- **Shielded funding:** the deposit is paid straight from an Orchard note, so the sender is not
  revealed and there is no unshield hop to a t-address of your own.
- **Transparent refund keys:** a BIP-44 key at `m/44'/133'/0'/0/0` from a fresh 24-word phrase,
  encoded as a mainnet `t1` address, made in the browser for one swap.
- **ZODL** as the reference wallet the demo pays from.

## How it uses NEAR Intents

- **1Click Swap API:** `/v0/tokens` for the ZEC asset and prices, `/v0/quote` with
  `EXACT_INPUT` and `confidentiality: "basic"`, `/v0/status` until the payout lands.
- **Confidential Intents:** every quote hides the deposit-to-payout link from the public record.
- **Explorer API:** the finished swaps the crowd is measured from, paged with
  `lastDepositAddress` inside the one-request-per-five-seconds limit.
- **Quote signatures:** checked with 1Click's published ed25519 key on the server and again in the
  browser; `/receipt` re-verifies a saved receipt.

## What is new

Projects such as ZecDoor and Unpair already route NEAR Intents swaps through the shielded pool,
which is the right foundation. Crowdline adds a measurement step in front of the swap: it reads the
public record an observer would use, puts a number on how linkable this particular swap is right
now, and changes the intent (amount, quote mode, refund address, funding source) before it
ships. It works alongside any wallet that can pay a ZIP-321 request; it does not replace one.

## Demo video script (2:00)

The form asks for two minutes. Record at 1440×900; keep the cursor slow.

| Time | Shot                                                                       | Voice-over                                                                                                                                     |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Explorer page with a public zec → USDC swap row                            | "This is a public swap out of Zcash. Deposit on the left, payout on the right, one row. Shielded until the moment it wasn't."                  |
| 0:12 | Landing page, scroll to the four leak cards                                | "Four things link a swap like this to a person: the public record, a unique amount, a reused refund address, and a transparent funding hop."   |
| 0:35 | `/app`: type 3.417 ZEC, USDC on Solana, payout address, "public", "reused" | "Crowdline checks it before anything is sent."                                                                                                 |
| 0:42 | Audit result with the live badge, score, findings                          | "It reads the last 24 hours of real swaps from the NEAR Intents Explorer. Sent like this: [score]/100. Here's why, line by line."              |
| 1:00 | Bucket list; pick the crowded amount; Harden                               | "Send a crowded amount instead; the rest stays shielded. Then a one-time refund address, made in this browser. The key never leaves it."       |
| 1:15 | Reveal recovery words briefly, tick saved, get quote                       | "Now a quote from 1Click with Confidential Intents and exact input."                                                                           |
| 1:25 | "Signed by 1Click" badge, QR, ZODL on a phone paying                       | "Crowdline verifies 1Click's signature, then shows a ZIP-321 request. I pay it from my shielded balance in ZODL."                              |
| 1:40 | Status reaches SUCCESS; evidence/README.md timeline                        | "Paid out on Solana. The receipt, both transactions and the 1Click status are in the repo for anyone to check."                                |
| 1:52 | Landing "What it can't do" section                                         | "It can't hide the deposit amount, and thin markets stay thin. It never holds your funds. Crowdline: check what your swap leaks, then fix it." |
| 2:00 | End                                                                        |                                                                                                                                                |

## Pre-submit checklist

- [ ] `pnpm check` and `pnpm build` green locally and in CI; badge green on GitHub
- [ ] Live app works on phone and desktop; `/`, `/app` and `/receipt` load
- [ ] Live crowd data on (badge says Live) and `/api/stats` shows real numbers
- [ ] A real confidential quote works from the live site, with its signature verified
- [ ] At least one mainnet run documented in `evidence/` with verifiable links
- [ ] README sections in order, diagrams render on GitHub, screens and poster present
- [ ] Video link in README, landing page (`apps/web/src/lib/links.ts`) and this file
- [ ] Repo public, MIT licensed, no secrets in history
      (`git log -p | Select-String "JWT|API_KEY"` shows only placeholders)
- [ ] Submitted on thezecathon.com before Oct 28, 23:59 UTC; confirmation saved
