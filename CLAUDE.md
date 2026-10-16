# Keplar One — working notes for Claude sessions

Read `docs/IMPLEMENTATION_STATUS.md` first: it is the durable progress record (what is built, verified, blocked, next).
Architecture is in `docs/ARCHITECTURE.md`; decisions and their reasons in `docs/DECISIONS.md`.

## Commands
- `npm install` — install all workspaces.
- `npm test` — server unit + integration tests against real Postgres (`TEST_DATABASE_URL`, default `postgres://keplar:keplar@localhost:5432/keplar_test`).
- `npm run build && npm run test:e2e` — Playwright + axe against the production build (needs database `keplar_e2e`).
- `npm run typecheck`, `npm run audit:deps`, `npm run scan:secrets`.
- `npm run dev` — migrate, then API (:3000), worker and Vite (:5173).

## Rules that matter here
- Every tenant-owned query filters on `workspace_id` from the session. Return 404, not 403, for other tenants' resources.
- Task and execution state changes go through `orchestrator/state-machine.ts` only (validated, audited, status-guarded).
- A task is never "completed" without passing `verification/verifier.ts` against persisted artifacts.
- Never mark capabilities, integrations or deployments as working without a test that exercises them.
- Update `docs/IMPLEMENTATION_STATUS.md` at the end of each work session.
