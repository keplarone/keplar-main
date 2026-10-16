import type { CapabilityId, ExecutionState, Permission, RetryPolicy, TaskState, VerificationCheck, VerificationCriterion } from "@keplar/contracts";
import type { Queryable } from "../db/pool.js";

export interface TaskRow {
  id: string;
  workspaceId: string;
  executionId: string;
  key: string;
  ordinal: number;
  title: string;
  description: string;
  capability: CapabilityId | null;
  inputs: Record<string, unknown>;
  expectedOutputs: string[];
  dependsOn: string[];
  permissions: Permission[];
  budgetMc: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  verification: VerificationCriterion[];
  verificationResults: VerificationCheck[];
  status: TaskState;
  attempts: number;
  outputs: Record<string, unknown> | null;
  evidence: string[];
  chargedMc: number;
  blockedReason: string | null;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ExecutionRow {
  id: string;
  workspaceId: string;
  createdBy: string;
  goal: string;
  intent: { kind: string; urls: string[]; gaps: { category: string; description: string; followUp: string }[] };
  status: ExecutionState;
  planner: string;
  planHash: string;
  estimatedMc: number;
  reservedMc: number;
  chargedMc: number;
  cancelRequested: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  planId: string;
}

export function toTask(r: Record<string, any>): TaskRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    executionId: r.execution_id,
    key: r.key,
    ordinal: r.ordinal,
    title: r.title,
    description: r.description,
    capability: r.capability,
    inputs: r.inputs,
    expectedOutputs: r.expected_outputs,
    dependsOn: r.depends_on,
    permissions: r.permissions,
    budgetMc: Number(r.budget_mc),
    timeoutMs: r.timeout_ms,
    retryPolicy: r.retry_policy,
    verification: r.verification,
    verificationResults: r.verification_results,
    status: r.status,
    attempts: r.attempts,
    outputs: r.outputs,
    evidence: r.evidence,
    chargedMc: Number(r.charged_mc),
    blockedReason: r.blocked_reason,
    lastError: r.last_error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function toExecution(r: Record<string, any>): ExecutionRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    createdBy: r.created_by,
    goal: r.goal,
    intent: r.intent,
    status: r.status,
    planner: r.planner,
    planHash: r.plan_hash,
    estimatedMc: Number(r.estimated_mc),
    reservedMc: Number(r.reserved_mc),
    chargedMc: Number(r.charged_mc),
    cancelRequested: r.cancel_requested,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    planId: r.plan_id,
  };
}

const EXECUTION_SELECT = `SELECT e.*, w.plan_id FROM executions e JOIN workspaces w ON w.id = e.workspace_id`;

/** Loads an execution scoped to a workspace. Optionally row-locks it for the rest of the transaction. */
export async function loadExecution(db: Queryable, workspaceId: string, executionId: string, lock = false): Promise<ExecutionRow | null> {
  const res = await db.query(`${EXECUTION_SELECT} WHERE e.id = $1 AND e.workspace_id = $2${lock ? " FOR UPDATE OF e" : ""}`, [executionId, workspaceId]);
  return res.rows[0] ? toExecution(res.rows[0]) : null;
}

export async function loadTasks(db: Queryable, executionId: string, lock = false): Promise<TaskRow[]> {
  const res = await db.query(`SELECT * FROM tasks WHERE execution_id = $1 ORDER BY ordinal${lock ? " FOR UPDATE" : ""}`, [executionId]);
  return res.rows.map(toTask);
}

export const json = (v: unknown) => JSON.stringify(v);
