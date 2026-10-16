import type { ExecutionState, TaskState } from "@keplar/contracts";
import type { Queryable } from "../db/pool.js";
import { AppError } from "../errors.js";

/** Allowed task transitions. Anything not listed is rejected and never persisted. */
const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  created: ["planned", "blocked", "cancelled"],
  planned: ["awaiting_approval", "queued", "blocked", "cancelled"],
  awaiting_approval: ["planned", "queued", "cancelled", "blocked"],
  queued: ["running", "cancelled", "blocked"],
  running: ["verifying", "retrying", "failed", "cancelled"],
  verifying: ["completed", "retrying", "failed", "cancelled"],
  retrying: ["running", "failed", "cancelled"],
  completed: [],
  blocked: [],
  failed: [],
  cancelled: [],
};

const EXECUTION_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  awaiting_approval: ["running", "cancelled", "blocked"],
  running: ["completed", "partially_completed", "failed", "blocked", "cancelled"],
  completed: [],
  partially_completed: [],
  blocked: [],
  failed: [],
  cancelled: [],
};

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function canTransitionExecution(from: ExecutionState, to: ExecutionState): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super(409, "invalid_transition", `${entity} cannot move from ${from} to ${to}`);
  }
}

export interface TransitionOptions {
  actor: string;
  reason?: string | null;
  /** Extra SET clauses applied atomically with the transition (column = $n placeholders start at $4). */
  set?: Record<string, unknown>;
  /** Optimistic fencing: only transition when tasks.attempts equals this value. */
  expectAttempts?: number;
}

/**
 * Validates and persists a task transition, guarded by the current status in the WHERE clause so
 * concurrent writers cannot both win. Writes an audit event in the same statement batch.
 * Returns false if the row was not in the expected state (lost race or fenced-out worker).
 */
export async function transitionTask(
  tx: Queryable,
  task: { id: string; workspaceId: string; executionId: string },
  from: TaskState,
  to: TaskState,
  opts: TransitionOptions,
): Promise<boolean> {
  if (!canTransitionTask(from, to)) throw new InvalidTransitionError("Task", from, to);
  const extra = Object.entries(opts.set ?? {});
  const setSql = extra.map(([col, _], i) => `, ${assertColumn(col)} = $${i + 5}`).join("");
  const params: unknown[] = [task.id, to, from, opts.expectAttempts ?? null, ...extra.map(([, v]) => v)];
  const res = await tx.query(
    `UPDATE tasks SET status = $2${setSql}
      WHERE id = $1 AND status = $3 AND ($4::int IS NULL OR attempts = $4::int)`,
    params,
  );
  if (res.rowCount !== 1) return false;
  await tx.query(
    `INSERT INTO execution_events (workspace_id, execution_id, task_id, from_status, to_status, actor, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [task.workspaceId, task.executionId, task.id, from, to, opts.actor, opts.reason ?? null],
  );
  return true;
}

export async function transitionExecution(
  tx: Queryable,
  exec: { id: string; workspaceId: string },
  from: ExecutionState,
  to: ExecutionState,
  opts: TransitionOptions,
): Promise<boolean> {
  if (!canTransitionExecution(from, to)) throw new InvalidTransitionError("Execution", from, to);
  const extra = Object.entries(opts.set ?? {});
  const setSql = extra.map(([col, _], i) => `, ${assertColumn(col)} = $${i + 4}`).join("");
  const res = await tx.query(
    `UPDATE executions SET status = $2, updated_at = now()${setSql} WHERE id = $1 AND status = $3`,
    [exec.id, to, from, ...extra.map(([, v]) => v)],
  );
  if (res.rowCount !== 1) return false;
  await tx.query(
    `INSERT INTO execution_events (workspace_id, execution_id, task_id, from_status, to_status, actor, reason)
     VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
    [exec.workspaceId, exec.id, from, to, opts.actor, opts.reason ?? null],
  );
  return true;
}

// Column names are interpolated into SQL, so only known identifiers are accepted.
const SETTABLE = new Set([
  "attempts", "outputs", "evidence", "verification_results", "blocked_reason", "last_error", "started_at", "finished_at",
  "charged_mc", "approved_by", "approved_at", "reserved_mc", "completed_at", "cancel_requested",
]);
function assertColumn(col: string): string {
  if (!SETTABLE.has(col)) throw new Error(`Column ${col} is not settable through a transition`);
  return col;
}
