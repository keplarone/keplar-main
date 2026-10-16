# Pricing and unit economics

All figures are **hypotheses** to validate with real usage. Nothing here is a profitability claim.

## Plans (enforced from `apps/server/src/billing/plans.ts`)

| Plan | Price/mo | Requests | Execution credits | Projects | Max per execution | Model tiers |
|---|---:|---:|---:|---:|---:|---|
| Free | $0 | 30 | 5 | 1 | 2 | light |
| Pro | $39 | 500 | 60 | 5 | 10 | light, standard |
| Plus | $99 | 1,500 | 200 | 20 | 25 | all |
| Business | $299 | 4,000 | 600 | 50 | 50 | all |
| Enterprise | from $1,500 | negotiated (defaults 20,000) | negotiated (3,000) | 500 | 200 | all |

A **request** is one planning call. An **execution credit** is 1,000 millicredits (mc), the ledger's integer unit.

## Weighted metering (implemented)

Each task is charged `min(budget, base_cost + provider_cost_usd / $0.15 × 1000 mc)`.

| Capability | Base cost |
|---|---:|
| `web.fetch` | 150 mc |
| `doc.compose` | 300 mc (+700 mc budget headroom when a model writes it) |
| `checklist.compose` | 200 mc (+700 mc with a model) |

Credits are **reserved** on approval at the plan estimate, **charged** at actual usage when the execution finishes, and the remainder is **released**. Failed or blocked tasks cost nothing except real provider spend on attempts that did not complete.

## Variable cost check (Pro, normal included usage)

- $39 / 60 credits ≈ $0.65 revenue per credit.
- Provider cost converts at $0.15 per credit, so model spend is at most ~23% of the credit's revenue, inside the 20–25% target.
- Example: a research brief from 3 pages on Claude Sonnet 5.5 with ~25k input / 3k output tokens costs ~$0.08 → 0.54 credits of provider spend + 0.75 base.
- Free tier guardrail: 5 credits × $0.15 = **$0.75** maximum provider spend per active free user per month (target $0.50–$1.00), and Free is limited to the light model tier (Claude Haiku 5.5).

## Not yet modelled

Infrastructure (Postgres, workers), storage, bandwidth, support, payment fees (~2.9% + $0.30), refunds, and overage pricing. Business seat counts and overage prices must be defined before launch. Model prices are Anthropic first-party list prices (Oct 2026) in `models/registry.ts` and must be re-checked before launch.
