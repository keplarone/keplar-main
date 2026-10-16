# Test strategy

| Layer | Tool | Location | Uses |
|---|---|---|---|
| Unit | Vitest | `apps/server/test/unit.test.ts`, `safe-fetch.test.ts` | Pure logic; a local HTTP server for the fetcher |
| Integration | Vitest + real PostgreSQL 16 | `auth.test.ts`, `execution.test.ts`, `isolation-and-billing.test.ts` | In-process Fastify (`inject`), real worker against the real database, a local fixture web server |
| End-to-end | Playwright (Chromium) + axe-core | `e2e/vertical-slice.spec.ts` | Production build: API serving the SPA + separate worker process |
| Security gates | `npm audit`, secret scan, gitleaks, CodeQL | CI | — |

Mocks are used only where a real dependency would make the test non-deterministic or cost money: the Anthropic client and model providers are faked; Postgres, HTTP, the worker and the browser are real.

## Coverage of the required categories

| Category | Status |
|---|---|
| Unit, integration, end-to-end | ✅ |
| Authentication, authorization, tenant isolation | ✅ |
| Payment and credit accounting | ✅ credits (concurrency, idempotency, settlement); ❌ payments (no billing provider yet) |
| Workflow retry, worker recovery | ✅ transient retry, verification repair, lease-expiry recovery, zombie fencing, cancellation |
| Prompt-injection resistance | ✅ structural (plan immutability); ❌ model-behaviour evals (needs a live model) |
| Rate limits | ✅ auth limiter, monthly request quota |
| Accessibility | ✅ axe (WCAG 2.2 AA tags) on every screen, keyboard path |
| Responsive | ✅ 390 px viewport, no horizontal scroll, dark mode |
| API contract | Partial: shared Zod contracts typecheck both sides; no schema snapshot tests yet |
| Dependency and secret scans | ✅ locally; CI jobs configured |
| Deployment smoke, backup/recovery | ❌ no deployment exists yet |

## Running

```bash
npm test                       # needs Postgres; TEST_DATABASE_URL overrides the default
npm run build && npm run test:e2e   # needs database keplar_e2e
```
