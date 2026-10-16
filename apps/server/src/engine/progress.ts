import type { ExecutionState } from "@keplar/contracts";
import { TERMINAL_TASK_STATES } from "@keplar/contracts";
import { settle } from "../billing/credits.js";
import { providerCostToMc } from "../billing/metering.js";
import type { Tx } from "../db/pool.js";
import { transitionExecution, transitionTask } from "../orchestrator/state-machine.js";
import { buildReceipt, storeReceipt } from "../verification/receipt.js";
import { enqueue } from "./queue.js";
import type { ExecutionRow } from "./rows.js";
import { loadExecution, loadTasks } from "./rows.js";

const FAILED_LIKE = new Set(["failed", "blocked", "cancelled"]);

/**
 * Moves dependents forward after a task reaches a terminal state: tasks whose dependencies all
 * completed are queued; tasks that depend on something that failed are blocked with a reason.
 * Repeats until nothing changes so blocking cascades through chains.
 */
export async function advanceDependents(tx: Tx, executionId: string, actor: string): Promise<void> {
  for (let changed = true; changed; ) {
    changed = false;
    const tasks = await loadTasks(tx, executionId);
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    for (const t of tasks.filter((x) => x.status === "planned")) {
      const deps = t.dependsOn.map((k) => byKey.get(k)!);
      const broken = deps.find((d) => FAILED_LIKE.has(d.status));
      if (broken) {
        changed ||= await transitionTask(tx, t, "planned", "blocked", {
          actor,
          reason: `Depends on ${broken.key}, which ${broken.status === "blocked" ? "is blocked" : broken.status === "cancelled" ? "was cancelled" : "failed"}`,
          set: { blocked_reason: `Depends on "${broken.title}", which did not complete.`, finished_at: new Date() },
        });
      } else if (deps.every((d) => d.status === "completed")) {
        if (await transitionTask(tx, t, "planned", "queued", { actor, reason: "Dependencies completed" })) {
          await enqueue(tx, t);
          changed = true;
        }
      }
    }
  }
}

export function finalStatus(statuses: string[], cancelRequested: boolean): ExecutionState {
  const completed = statuses.filter((s) => s === "completed").length;
  if (cancelRequested) return "cancelled";
  if (completed === statuses.length) return "completed";
  if (completed > 0) return "partially_completed";
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  return "blocked";
}

/**
 * If every task is terminal, settles credits, records the final status and issues the outcome
 * receipt — all in the caller's transaction, under a row lock on the execution so exactly one
 * worker finalizes. Safe to call repeatedly.
 */
export async function finalizeIfDone(tx: Tx, workspaceId: string, executionId: string, actor: string): Promise<ExecutionRow | null> {
  const exec = await loadExecution(tx, workspaceId, executionId, true);
  if (!exec || (exec.status !== "running" && exec.status !== "awaiting_approval")) return null;
  const tasks = await loadTasks(tx, executionId);
  if (!tasks.every((t) => TERMINAL_TASK_STATES.includes(t.status))) return null;

  // Actual usage: what completed tasks charged, plus provider spend on attempts that did not complete.
  const unfinishedSpend = await tx.query<{ usd_micros: number }>(
    `SELECT COALESCE(SUM(m.cost_usd_micros), 0) AS usd_micros FROM model_calls m JOIN tasks t ON t.id = m.task_id
      WHERE m.execution_id = $1 AND t.status <> 'completed'`,
    [executionId],
  );
  const actualMc =
    tasks.filter((t) => t.status === "completed").reduce((s, t) => s + t.chargedMc, 0) +
    providerCostToMc(Number(unfinishedSpend.rows[0]?.usd_micros ?? 0) / 1_000_000);
  const { chargedMc } = exec.reservedMc > 0 ? await settle(tx, workspaceId, executionId, exec.reservedMc, actualMc) : { chargedMc: 0 };

  const status = finalStatus(tasks.map((t) => t.status), exec.cancelRequested);
  const now = new Date();
  await transitionExecution(tx, exec, exec.status, status, {
    actor,
    reason: `All ${tasks.length} tasks reached a final state`,
    set: { charged_mc: chargedMc, completed_at: now },
  });
  const receipt = await buildReceipt(tx, { ...exec, status, chargedMc, completedAt: now });
  await storeReceipt(tx, receipt);
  return { ...exec, status, chargedMc, completedAt: now };
}
