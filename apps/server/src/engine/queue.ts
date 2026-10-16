import type { Queryable } from "../db/pool.js";
import type { TaskRow } from "./rows.js";

export interface JobRow {
  id: number;
  workspaceId: string;
  executionId: string;
  taskId: string;
  status: "queued" | "leased" | "succeeded" | "dead" | "cancelled";
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
}

function toJob(r: Record<string, any>): JobRow {
  return {
    id: Number(r.id),
    workspaceId: r.workspace_id,
    executionId: r.execution_id,
    taskId: r.task_id,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    leaseOwner: r.lease_owner,
  };
}

/** One job per task; enqueueing the same task twice is a no-op (idempotent). */
export async function enqueue(tx: Queryable, task: Pick<TaskRow, "id" | "workspaceId" | "executionId" | "retryPolicy">): Promise<void> {
  await tx.query(
    `INSERT INTO jobs (workspace_id, execution_id, task_id, status, max_attempts) VALUES ($1, $2, $3, 'queued', $4)
     ON CONFLICT (task_id) DO NOTHING`,
    [task.workspaceId, task.executionId, task.id, task.retryPolicy.maxAttempts],
  );
}

/**
 * Claims the next runnable job: a queued job whose run_after has passed, or a leased job whose
 * lease expired (its worker crashed or stalled). SKIP LOCKED lets many workers claim concurrently
 * without blocking or double-claiming. The attempt counter doubles as a fencing token.
 */
export async function claim(db: Queryable, workerId: string, leaseMs: number): Promise<JobRow | null> {
  const res = await db.query(
    `UPDATE jobs SET status = 'leased', lease_owner = $1, lease_expires_at = now() + make_interval(secs => $2::double precision / 1000),
            attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
         WHERE (status = 'queued' AND run_after <= now()) OR (status = 'leased' AND lease_expires_at < now())
         ORDER BY run_after, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [workerId, leaseMs],
  );
  return res.rows[0] ? toJob(res.rows[0]) : null;
}

/** Extends the lease. Returns false when this worker no longer owns the job (fenced out). */
export async function heartbeat(db: Queryable, job: JobRow, workerId: string, leaseMs: number): Promise<{ owned: boolean; cancelRequested: boolean }> {
  const res = await db.query<{ cancel_requested: boolean }>(
    `UPDATE jobs j SET lease_expires_at = now() + make_interval(secs => $4::double precision / 1000), updated_at = now()
       FROM executions e
      WHERE j.id = $1 AND j.lease_owner = $2 AND j.attempts = $3 AND j.status = 'leased' AND e.id = j.execution_id
      RETURNING e.cancel_requested`,
    [job.id, workerId, job.attempts, leaseMs],
  );
  const row = res.rows[0];
  return { owned: Boolean(row), cancelRequested: Boolean(row?.cancel_requested) };
}

const FENCE = "id = $1 AND lease_owner = $2 AND attempts = $3 AND status = 'leased'";

export async function markSucceeded(tx: Queryable, job: JobRow, workerId: string): Promise<boolean> {
  const res = await tx.query(`UPDATE jobs SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE ${FENCE}`, [job.id, workerId, job.attempts]);
  return res.rowCount === 1;
}

export async function scheduleRetry(tx: Queryable, job: JobRow, workerId: string, delayMs: number, error: string): Promise<boolean> {
  const res = await tx.query(
    `UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, last_error = $4,
            run_after = now() + make_interval(secs => $5::double precision / 1000), updated_at = now()
      WHERE ${FENCE}`,
    [job.id, workerId, job.attempts, error, delayMs],
  );
  return res.rowCount === 1;
}

/** Dead-letters the job: kept for inspection, never claimed again. */
export async function markDead(tx: Queryable, job: JobRow, workerId: string, error: string): Promise<boolean> {
  const res = await tx.query(`UPDATE jobs SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL, last_error = $4, updated_at = now() WHERE ${FENCE}`, [job.id, workerId, job.attempts, error]);
  return res.rowCount === 1;
}

export async function markCancelled(tx: Queryable, jobId: number): Promise<void> {
  await tx.query(`UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND status IN ('queued', 'leased')`, [jobId]);
}

export async function cancelQueuedJobs(tx: Queryable, executionId: string): Promise<void> {
  await tx.query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE execution_id = $1 AND status = 'queued'`, [executionId]);
}

/** Exponential backoff with full jitter, bounded by the task's retry policy. */
export function backoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number, random = Math.random): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.max(baseDelayMs / 2, Math.floor(random() * ceiling));
}
