# Execution engine

## Task graph

Every task stores: id, execution (goal) id, key, description, inputs, expected outputs, dependencies, capability, permissions, budget (millicredits), timeout, retry policy, verification criteria, status, attempts, evidence and verification results (`tasks` table, `TaskView` contract).

## States

Task: `created → planned → awaiting_approval → queued → running → verifying → completed`, with `retrying`, `blocked`, `failed`, `cancelled`. Allowed transitions are a fixed table in `orchestrator/state-machine.ts`; `running → completed` is impossible (verification cannot be skipped) and terminal states never change. Each transition is an `UPDATE … WHERE status = <expected>` plus an `execution_events` row in the same transaction.

Execution: `awaiting_approval → running → completed | partially_completed | failed | blocked | cancelled`.

## Queue and workers

- One `jobs` row per task (`UNIQUE(task_id)`, so enqueueing is idempotent).
- **Claim:** `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)` picks a queued job whose `run_after` passed, or a leased job whose lease expired. Claiming increments `attempts`, which is also the **fencing token**.
- **Lease + heartbeat:** the runner extends the lease every `lease/3`. If the heartbeat finds it no longer owns the job, it aborts. The heartbeat also observes `cancel_requested`.
- **Commit with fencing:** results are persisted only if `tasks.attempts` still equals the worker's attempt, so a stalled "zombie" worker cannot overwrite a newer attempt (tested).
- **Timeouts:** each task runs under `AbortSignal.any([cancel, timeout])`; the runner stops waiting even if a handler ignores the signal.
- **Retries:** transient failures move to `retrying` and requeue with exponential backoff and full jitter, bounded by the task's policy. Policy violations (SSRF block, 4xx, refusals) are permanent and never retried.
- **Dead letters:** exhausted jobs become `dead` with their last error, kept for inspection.
- **Crash recovery:** a job leased by a dead worker is reclaimed after lease expiry; the task records `running → retrying` with "lease expired" and continues (tested).
- **Cancellation:** pending tasks are cancelled immediately; running tasks abort at their next heartbeat.

## Dependencies and finalization

After any task finishes, `advanceDependents` queues tasks whose dependencies all completed and blocks tasks whose dependencies failed, cascading. `finalizeIfDone` row-locks the execution, and once every task is terminal it settles credits, sets the final status and writes the receipt — once, idempotently.

## Verification (repair loop)

The runner re-reads the artifacts it just persisted and evaluates criteria fixed at planning time: `artifact_exists`, `artifact_integrity` (SHA-256), `min_length`, `has_sections`, `cites_sources`, `no_placeholders`, `min_items`, `http_ok`. A failed verification is retried within the task's attempt budget, then fails. Empty criteria never pass.

## Durability limits (honest)

Postgres-backed leasing gives at-least-once execution with fencing. Capabilities in this slice have no external side effects, so re-running is safe. Before adding side-effecting capabilities (payments, email), each must carry an idempotency key to the provider and check actual state before retrying (see SECURITY_MODEL.md).
