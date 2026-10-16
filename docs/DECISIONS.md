# Decisions

Each entry records what was decided, why, and what would make us revisit it.

## D-001 — Monorepo with two process types
npm workspaces: `apps/server` (API + worker entry points from one codebase), `apps/web`, `packages/contracts` (shared Zod schemas and types). The API never runs task work; workers never serve HTTP. **Why:** a request handler must not hold long-running, retryable work, and shared contracts stop the client and server drifting. **Revisit:** if capability runtimes need different languages or isolation.

## D-002 — PostgreSQL as the job queue (not Temporal, SQS or Redis)
Jobs are rows claimed with `FOR UPDATE SKIP LOCKED` under leases with heartbeats; the attempt counter is a fencing token. **Why:** job state, task state, credits and audit events commit in the same transaction, so there is no dual-write gap; one dependency to operate. **Revisit:** sustained throughput above a few hundred jobs/s, or workflows needing long timers and versioned code — then Temporal.

## D-003 — Deterministic rules-based planner first
`keplar-planner/rules-v1` maps a goal to a small, fixed set of task templates and detects capability gaps (payments, bookings, messaging, deployment, app building). **Why:** a plan the user approves must be reproducible and hashable, and gaps must be stated honestly rather than improvised. A model-based planner can be added behind the same `BuiltPlan` contract and still produce a hashed, approved graph. **Revisit:** when goal coverage, not reliability, is the bottleneck.

## D-004 — Template composer when no model is configured, clearly labelled
Without `ANTHROPIC_API_KEY`, documents are composed from templates and marked as such in evidence, artifacts and the receipt. **Why:** the slice must run end to end in CI and locally without a paid key, and must never pass template output off as model output.

## D-005 — Millicredits, reserved before work and settled after
1 credit = 1000 mc. Approval reserves the estimate; finalization charges actual use and releases the rest. Ledger rows carry idempotency keys; balances have CHECK constraints. **Why:** integer arithmetic, no overspend under concurrency, and an auditable trail. **Revisit:** when Stripe metered billing is connected (credits stay the internal unit).

## D-006 — Opaque server-side sessions, not JWTs
Random 256-bit token in an HttpOnly cookie, stored as SHA-256. **Why:** instant revocation and nothing sensitive in the browser. **Revisit:** for a public API — add scoped API keys alongside, not instead.

## D-007 — Tenant isolation in the application layer; no Postgres RLS yet
Every tenant query filters on the session's `workspace_id`, and tests assert cross-tenant reads return 404. **Why:** simpler to reason about at this size. **Risk:** one missed filter leaks data. **Planned:** add RLS as defence in depth before multi-member workspaces ship.

## D-008 — Anthropic models only, routed by cost tier
Light → `claude-haiku-5-5`, standard → `claude-sonnet-5-5`, complex → `claude-opus-5-5`. The router falls back to cheaper models and never escalates silently. **Why:** one provider keeps the first slice testable; cost control matters more than breadth. **Revisit:** when a second provider is needed for resilience.

## D-009 — Receipts are stored as exact text with a SHA-256 digest
The browser recomputes the digest before showing "checked". **Why:** tamper evidence, not signatures — an operator with database access could still rewrite both. **Planned:** sign receipts with a KMS-held key (an established algorithm, e.g. Ed25519) once a key service is chosen.
