# Keplar: Whop → OpenRouter credits

When a user pays for a plan on Whop, they automatically get OpenRouter credit:

| Whop plan | Credit added per payment (incl. every renewal) |
|---|---|
| Lite | $4.80 |
| Plus | $12.00 |
| Pro  | $27.00 |

Users can also **buy more credits** (one-time Whop credit packs) and turn on
**auto top-up**, which charges their saved card for a pack when their balance
falls below a threshold they choose.

## How it works

Your OpenRouter account holds one pooled balance. Each user gets their **own
OpenRouter API key with a spending limit** equal to the credit they have paid
for. Paying adds to that limit; spending counts against it.

```
Whop payment.succeeded ──▶ /api/webhooks/whop
   verify signature → credit_ledger (+4.80 / +12 / +27 / +pack)
   → set the user's OpenRouter key limit = SUM(ledger)
```

- **Idempotent.** The ledger is unique on the Whop payment id, and the key
  limit is always set to the ledger total (never "+= amount"), so duplicate or
  retried webhooks can't grant twice.
- **Refunds** (`refund.created`/`refund.updated`, status `succeeded`) take back a
  proportional share of that payment's credit.
- **$0 payments** (free trials, 100% promo codes) grant nothing.
- **Auto top-up:** the user picks a pack and a threshold. If they have no saved
  card, they're sent to a Whop setup-mode checkout. `setup_intent.succeeded`
  saves the card. After each AI request, and every 10 minutes by cron, we check
  their balance and, if it's below the threshold, charge the saved card
  off-session via `payments.create`. The resulting `payment.succeeded` grants the
  credit. A failed or 3-D Secure-blocked charge switches auto top-up off and
  stores the reason. There is at most one charge in flight per user and at most
  `AUTOTOPUP_MAX_PER_DAY` per day.
- Users never see their OpenRouter key: it's stored AES-256-GCM encrypted and
  used only by the server-side proxy at `/api/ai/chat`.

## API

| Route | Who | What |
|---|---|---|
| `POST /api/webhooks/whop` | Whop | payment / refund / setup-intent events |
| `GET /api/credits` | user | balance, auto top-up settings, available packs |
| `POST /api/credits/checkout` `{packPlanId}` | user | returns a Whop checkout `url` for a credit pack |
| `GET/POST /api/credits/auto-topup` `{enabled, thresholdUsd, packPlanId}` | user | settings; returns `setupUrl` if a card must be saved first |
| `POST /api/ai/chat` | user | OpenAI-style chat completion through the user's capped key |
| `GET /api/cron/auto-topup` | Vercel cron | checks every user with auto top-up on |

User routes authenticate with Whop's `x-whop-user-token` header (`lib/auth.ts`).

## Setup

1. **OpenRouter:** create a *provisioning* key. In Settings → Credits, turn on
   OpenRouter's own auto top-up for your account so the shared pool never runs
   dry. Per-user limits stop any one user from spending more than they paid for.
2. **Whop:** note the plan ids for Lite/Plus/Pro, and create one-time plans for
   credit packs (e.g. $5.50 → $5 credit). Create a company webhook pointing to
   `https://<your-app>/api/webhooks/whop` with the events `payment.succeeded`,
   `payment.failed`, `payment.requires_action`, `refund.created`,
   `refund.updated` and `setup_intent.succeeded`.
3. Copy `.env.example` to your Vercel env vars, then run `npm run db:migrate` against your database.
4. Deploy. The cron in `vercel.json` runs every 10 minutes. Vercel's Hobby plan
   only allows daily crons; on Hobby, auto top-up still runs after each AI request.

## Development

```sh
npm install
npm test          # needs Postgres: TEST_DATABASE_URL (default postgres://keplar:keplar@localhost:5432/keplar_test)
npm run typecheck
npm run build
```

## Pricing note

OpenRouter charges a fee when you buy credits, and Whop takes processing fees.
Price credit packs above the credit they grant (e.g. $5.50 for $5) so top-ups
don't lose money.
