import type { OutcomeReceipt, OutcomeState, ReceiptTaskEntry, TaskState } from "@keplar/contracts";
import type { Queryable } from "../db/pool.js";
import type { ExecutionRow, TaskRow } from "../engine/rows.js";
import { loadTasks } from "../engine/rows.js";
import { sha256Hex } from "./verifier.js";

/** Maps internal task state to the receipt's outcome vocabulary. Completion here always means verified. */
export function outcomeOf(task: Pick<TaskRow, "status" | "verificationResults">): OutcomeState {
  const map: Record<TaskState, OutcomeState> = {
    created: "planned",
    planned: "planned",
    awaiting_approval: "awaiting_approval",
    queued: "submitted",
    running: "accepted",
    verifying: "prepared",
    retrying: "accepted",
    completed: task.verificationResults.length > 0 && task.verificationResults.every((c) => c.passed) ? "independently_verified" : "completed",
    blocked: "blocked",
    failed: "failed",
    cancelled: "cancelled",
  };
  return map[task.status];
}

function entry(t: TaskRow): ReceiptTaskEntry {
  return {
    key: t.key,
    title: t.title,
    capability: t.capability,
    outcome: outcomeOf(t),
    attempts: t.attempts,
    verification: t.verificationResults,
    evidence: t.evidence,
    error: t.lastError,
    blockedReason: t.blockedReason,
  };
}

export async function buildReceipt(db: Queryable, exec: ExecutionRow & { completedAt: Date }): Promise<OutcomeReceipt> {
  const tasks = await loadTasks(db, exec.id);
  // Only artifacts from each completed task's final attempt are evidence of the outcome.
  const artifacts = await db.query(
    `SELECT a.id, a.name, a.sha256, a.size_bytes, a.source_url FROM artifacts a JOIN tasks t ON t.id = a.task_id
      WHERE a.execution_id = $1 AND t.status = 'completed' AND a.attempt = t.attempts ORDER BY t.ordinal, a.name`,
    [exec.id],
  );
  const calls = await db.query(
    `SELECT provider, model, input_tokens, output_tokens, cost_usd_micros FROM model_calls WHERE execution_id = $1 ORDER BY id`,
    [exec.id],
  );
  const modelCalls = calls.rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: Number(r.cost_usd_micros) / 1_000_000,
  }));
  const followUp = [
    ...tasks.filter((t) => t.status === "blocked" && t.blockedReason).map((t) => `${t.title}: ${t.blockedReason}`),
    ...tasks.filter((t) => t.status === "failed").map((t) => `${t.title} failed: ${t.lastError ?? "unknown error"}`),
  ];
  const startedAt = exec.startedAt ?? exec.createdAt;
  return {
    receiptVersion: 1,
    executionId: exec.id,
    workspaceId: exec.workspaceId,
    goal: exec.goal,
    finalStatus: exec.status,
    planner: exec.planner,
    planHash: exec.planHash,
    approvedBy: exec.approvedBy,
    approvedAt: exec.approvedAt?.toISOString() ?? null,
    completedAt: exec.completedAt.toISOString(),
    tasks: {
      completed: tasks.filter((t) => t.status === "completed").map(entry),
      failed: tasks.filter((t) => t.status === "failed").map(entry),
      blocked: tasks.filter((t) => t.status === "blocked").map(entry),
      pending: tasks.filter((t) => !["completed", "failed", "blocked"].includes(t.status)).map(entry),
    },
    artifacts: artifacts.rows.map((a) => ({ id: a.id, name: a.name, sha256: a.sha256, sizeBytes: a.size_bytes, sourceUrl: a.source_url })),
    // No external systems are written to in this slice, so there is nothing external to confirm.
    externalConfirmations: [],
    usage: {
      estimatedMc: exec.estimatedMc,
      chargedMc: exec.chargedMc,
      releasedMc: Math.max(0, exec.reservedMc - exec.chargedMc),
      modelCalls,
      providerCostUsd: modelCalls.reduce((s, c) => s + c.costUsd, 0),
      wallClockMs: Math.max(0, exec.completedAt.getTime() - startedAt.getTime()),
    },
    humanFollowUp: followUp,
  };
}

export async function storeReceipt(db: Queryable, receipt: OutcomeReceipt): Promise<void> {
  const body = JSON.stringify(receipt);
  await db.query(
    `INSERT INTO receipts (workspace_id, execution_id, body, sha256) VALUES ($1, $2, $3, $4) ON CONFLICT (execution_id) DO NOTHING`,
    [receipt.workspaceId, receipt.executionId, body, sha256Hex(body)],
  );
}
