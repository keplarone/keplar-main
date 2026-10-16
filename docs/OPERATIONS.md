# Operations

**Status:** structured logging and health checks exist; metrics, tracing, dashboards and alerting do not.

## Implemented

- `GET /api/health` (liveness) and `GET /api/ready` (database reachable → 200, else 503).
- Structured JSON logs from the API (pino, with cookie/CSRF redaction) and the worker.
- Every state change is in `execution_events`; security events in `audit_log`; every model call in `model_calls` with tokens, cost and latency.
- Dead-lettered jobs stay in `jobs` with `status = 'dead'` and `last_error`.

## Useful queries

```sql
-- Queue depth by state
SELECT status, count(*) FROM jobs GROUP BY status;
-- Jobs stuck past their lease (should be reclaimed automatically)
SELECT id, task_id, lease_owner, lease_expires_at FROM jobs WHERE status = 'leased' AND lease_expires_at < now();
-- Dead letters in the last day
SELECT id, task_id, last_error FROM jobs WHERE status = 'dead' AND updated_at > now() - interval '1 day';
-- Provider spend today
SELECT model, sum(cost_usd_micros)/1e6 AS usd FROM model_calls WHERE created_at > current_date GROUP BY model;
-- Ledger consistency: reserved balances must equal open reservations
SELECT a.workspace_id, a.reserved_mc, coalesce(sum(e.reserved_mc) FILTER (WHERE e.status = 'running'), 0) AS open
  FROM credit_accounts a LEFT JOIN executions e ON e.workspace_id = a.workspace_id GROUP BY 1, 2 HAVING a.reserved_mc <> coalesce(sum(e.reserved_mc) FILTER (WHERE e.status = 'running'), 0);
```

## Proposed service objectives (to instrument)

API availability 99.9%; p95 plan latency < 500 ms; 99% of queued jobs claimed within 10 s; zero ledger inconsistencies.

## Incident basics

1. Check `/api/ready` and Postgres health. 2. Check queue depth and dead letters. 3. Workers are safe to restart at any time; leases return work to the queue. 4. Record the incident and follow-ups in DECISIONS.md or the tracker.
