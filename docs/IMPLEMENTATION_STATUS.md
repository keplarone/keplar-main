# Implementation status

_Last updated: 2026-10-16. This is the durable progress record; update it at the end of every work session._

Legend: **Implemented** = working code with automated tests. **Partial** = code exists but something material is untested or missing. **Not started** = no code.

## Vertical slice: goal → plan → approval → execution → verification → receipt

| Area | Status | Evidence |
|---|---|---|
| Email/password accounts, sessions, CSRF, auth rate limit | Implemented | `apps/server/test/auth.test.ts` |
| Workspaces and tenant isolation | Implemented | `isolation-and-billing.test.ts` (cross-tenant 404s) |
| Goal interpretation + capability-gap detection | Implemented | `unit.test.ts` (including false-positive cases) |
| Rules-based planner, task graph, plan hash | Implemented | `unit.test.ts`, `execution.test.ts` |
| Approval of the exact plan (hash-checked) | Implemented | `execution.test.ts` |
| Durable Postgres queue, leases, retries, dead letters, cancellation, recovery | Implemented | `execution.test.ts` (retry, lease expiry, zombie fencing, cancel) |
| Capability: public web fetch (SSRF-guarded) | Implemented | `safe-fetch.test.ts`, `execution.test.ts` |
| Capability: brief / checklist / research composition (template) | Implemented | `execution.test.ts`, e2e |
| Capability: composition via Claude | **Partial** | Adapter + gateway tested with a fake client; **never called against the live API** (no key in this environment) |
| Model router + cost recording | Implemented (fake providers) | `unit.test.ts`, `execution.test.ts` |
| Independent verifier | Implemented | `unit.test.ts`, `execution.test.ts` |
| Outcome receipts with digest | Implemented | `execution.test.ts`, e2e (browser digest check) |
| Credits: plans, reservations, settlement, request quota | Implemented | `isolation-and-billing.test.ts` |
| Web app: sign-in, composer, plan approval, live progress, results, receipt, history | Implemented | `e2e/vertical-slice.spec.ts` with axe, 390 px, dark mode, keyboard |
| CI (typecheck, tests, build, audit, secret scans, CodeQL, e2e) | **Partial** | Workflow written; **not yet run on GitHub** |

## Not started

Stripe billing and invoices · OAuth integrations (GitHub, Google, etc.) · web search · website/app generation · multi-agent orchestration · workflow marketplace · usage/cost dashboard UI · team workspaces and roles UI · deployment, metrics, tracing, alerting · email verification and password reset · MFA · receipt signing · Postgres RLS.

## Last verified run (local, this environment)

See the PR description for exact counts; re-run with `npm test` and `npm run test:e2e`.

## Blocked on the owner

- `ANTHROPIC_API_KEY` (secret manager) to exercise the live model path.
- Hosting, database and domain choices for a first deployment (paid commitments).
- Stripe account for billing.

## Next

1. Run CI on GitHub and fix anything environment-specific.
2. Live-model integration test behind a key, plus prompt-injection evals.
3. Usage and cost dashboard (data already recorded in `model_calls` and the ledger).
4. Email verification and password reset.
5. Choose hosting; staging deployment with smoke tests.
