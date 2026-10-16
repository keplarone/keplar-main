import type { ExecutionListItem, ExecutionView, OutcomeReceipt } from "@keplar/contracts";
import type { AuthContext } from "../auth/service.js";
import { consumeRequest, reserve } from "../billing/credits.js";
import { getPlan } from "../billing/plans.js";
import type { Db } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { AppError, conflict, notFound } from "../errors.js";
import { advanceDependents, finalizeIfDone } from "../engine/progress.js";
import { cancelQueuedJobs, enqueue } from "../engine/queue.js";
import { json, loadExecution, loadTasks } from "../engine/rows.js";
import { interpretGoal } from "./intent.js";
import { buildPlan } from "./planner.js";
import { transitionExecution, transitionTask } from "./state-machine.js";

export interface OrchestratorOptions {
  modelProviderConfigured: boolean;
}

/** Interprets the goal, builds the task graph and stores it awaiting the user's approval. */
export async function createExecution(db: Db, ctx: AuthContext, goal: string, opts: OrchestratorOptions): Promise<string> {
  const plan = getPlan(ctx.planId);
  const intent = interpretGoal(goal);
  const built = buildPlan(goal, intent, { modelAvailable: opts.modelProviderConfigured && plan.modelTiers.length > 0 });
  if (built.estimatedMc > plan.maxCreditsPerExecutionMc) {
    throw new AppError(402, "execution_budget_exceeded", "This goal needs more credits than one execution may use on your plan.", {
      estimatedMc: built.estimatedMc,
      limitMc: plan.maxCreditsPerExecutionMc,
    });
  }
  return withTx(db, async (tx) => {
    await consumeRequest(tx, ctx.workspaceId, plan.monthlyRequests);
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO executions (workspace_id, created_by, goal, intent, status, planner, plan_hash, estimated_mc)
       VALUES ($1, $2, $3, $4, 'awaiting_approval', $5, $6, $7) RETURNING id`,
      [ctx.workspaceId, ctx.userId, goal, json({ kind: intent.kind, urls: intent.urls, gaps: intent.gaps }), built.planner, built.hash, built.estimatedMc],
    );
    const executionId = ins.rows[0]!.id;
    await tx.query(
      `INSERT INTO execution_events (workspace_id, execution_id, from_status, to_status, actor, reason) VALUES ($1, $2, NULL, 'awaiting_approval', $3, $4)`,
      [ctx.workspaceId, executionId, `user:${ctx.userId}`, `Planned ${built.tasks.length} ${built.tasks.length === 1 ? "task" : "tasks"} with ${built.planner}`],
    );
    for (const t of built.tasks) {
      const row = await tx.query<{ id: string }>(
        `INSERT INTO tasks (workspace_id, execution_id, key, ordinal, title, description, capability, inputs, expected_outputs, depends_on,
                            permissions, budget_mc, timeout_ms, retry_policy, verification, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'created') RETURNING id`,
        [ctx.workspaceId, executionId, t.key, t.ordinal, t.title, t.description, t.capability, json(t.inputs), json(t.expectedOutputs),
          t.dependsOn, t.permissions, t.budgetMc, t.timeoutMs, json(t.retryPolicy), json(t.verification)],
      );
      const ref = { id: row.rows[0]!.id, workspaceId: ctx.workspaceId, executionId };
      if (t.blockedReason) {
        await transitionTask(tx, ref, "created", "blocked", { actor: "planner", reason: t.blockedReason, set: { blocked_reason: t.blockedReason } });
      } else {
        await transitionTask(tx, ref, "created", "planned", { actor: "planner", reason: "Added to plan" });
        await transitionTask(tx, ref, "planned", "awaiting_approval", { actor: "planner", reason: "Waiting for your approval" });
      }
    }
    if (built.tasks.every((t) => t.blockedReason)) {
      // Nothing can run: close it out now with an honest receipt instead of asking for approval.
      await finalizeIfDone(tx, ctx.workspaceId, executionId, "planner");
    }
    return executionId;
  });
}

/** The user authorizes exactly the plan they saw (by hash). Credits are reserved before any work starts. */
export async function approveExecution(db: Db, ctx: AuthContext, executionId: string, planHash: string): Promise<void> {
  await withTx(db, async (tx) => {
    const exec = await loadExecution(tx, ctx.workspaceId, executionId, true);
    if (!exec) throw notFound("Execution");
    if (exec.status !== "awaiting_approval") throw conflict("not_awaiting_approval", `This execution is ${exec.status.replace("_", " ")}, not awaiting approval.`);
    if (exec.planHash !== planHash) throw conflict("plan_changed", "The plan changed since you reviewed it. Review it again before approving.");
    await reserve(tx, ctx.workspaceId, executionId, exec.estimatedMc);
    const now = new Date();
    await transitionExecution(tx, exec, "awaiting_approval", "running", {
      actor: `user:${ctx.userId}`,
      reason: "Approved",
      set: { approved_by: ctx.userId, approved_at: now, reserved_mc: exec.estimatedMc, started_at: now } as Record<string, unknown>,
    });
    const tasks = await loadTasks(tx, executionId, true);
    for (const t of tasks.filter((x) => x.status === "awaiting_approval")) {
      if (t.dependsOn.length === 0) {
        await transitionTask(tx, t, "awaiting_approval", "queued", { actor: `user:${ctx.userId}`, reason: "Approved; queued for a worker" });
        await enqueue(tx, t);
      } else {
        await transitionTask(tx, t, "awaiting_approval", "planned", { actor: `user:${ctx.userId}`, reason: "Approved; waiting on dependencies" });
      }
    }
    await advanceDependents(tx, executionId, "orchestrator");
  });
}

/** Cancels pending work immediately; running tasks stop at their next heartbeat. */
export async function cancelExecution(db: Db, ctx: AuthContext, executionId: string): Promise<void> {
  await withTx(db, async (tx) => {
    const exec = await loadExecution(tx, ctx.workspaceId, executionId, true);
    if (!exec) throw notFound("Execution");
    if (exec.status !== "awaiting_approval" && exec.status !== "running") {
      throw conflict("already_finished", `This execution is already ${exec.status.replace("_", " ")}.`);
    }
    const actor = `user:${ctx.userId}`;
    await tx.query("UPDATE executions SET cancel_requested = true, updated_at = now() WHERE id = $1", [executionId]);
    await cancelQueuedJobs(tx, executionId);
    for (const t of await loadTasks(tx, executionId, true)) {
      if (["created", "planned", "awaiting_approval", "queued", "retrying"].includes(t.status)) {
        await transitionTask(tx, t, t.status, "cancelled", { actor, reason: "Cancelled by user", set: { finished_at: new Date() } });
      }
    }
    await finalizeIfDone(tx, ctx.workspaceId, executionId, actor);
  });
}

export async function listExecutions(db: Db, ctx: AuthContext): Promise<ExecutionListItem[]> {
  const res = await db.query(
    "SELECT id, goal, status, created_at FROM executions WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50",
    [ctx.workspaceId],
  );
  return res.rows.map((r) => ({ id: r.id, goal: r.goal, status: r.status, createdAt: r.created_at.toISOString() }));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getExecutionView(db: Db, ctx: AuthContext, executionId: string): Promise<ExecutionView> {
  const exec = await loadExecution(db, ctx.workspaceId, executionId);
  if (!exec) throw notFound("Execution");
  const [tasks, artifacts, events, receipt] = await Promise.all([
    loadTasks(db, executionId),
    db.query(
      `SELECT a.id, a.task_id, a.kind, a.name, a.media_type, a.sha256, a.size_bytes, a.source_url, a.created_at
         FROM artifacts a JOIN tasks t ON t.id = a.task_id
        WHERE a.execution_id = $1 AND a.workspace_id = $2 AND a.attempt = t.attempts ORDER BY t.ordinal, a.name`,
      [executionId, ctx.workspaceId],
    ),
    db.query(
      `SELECT ev.id, t.key AS task_key, ev.from_status, ev.to_status, ev.actor, ev.reason, ev.created_at
         FROM execution_events ev LEFT JOIN tasks t ON t.id = ev.task_id
        WHERE ev.execution_id = $1 AND ev.workspace_id = $2 ORDER BY ev.id DESC LIMIT 200`,
      [executionId, ctx.workspaceId],
    ),
    db.query("SELECT id FROM receipts WHERE execution_id = $1 AND workspace_id = $2", [executionId, ctx.workspaceId]),
  ]);
  return {
    id: exec.id,
    goal: exec.goal,
    status: exec.status,
    intent: exec.intent,
    planner: exec.planner,
    planHash: exec.planHash,
    estimatedMc: exec.estimatedMc,
    reservedMc: exec.reservedMc,
    chargedMc: exec.chargedMc,
    createdAt: exec.createdAt.toISOString(),
    approvedAt: iso(exec.approvedAt),
    completedAt: iso(exec.completedAt),
    tasks: tasks.map((t) => ({
      id: t.id,
      key: t.key,
      ordinal: t.ordinal,
      title: t.title,
      description: t.description,
      capability: t.capability,
      inputs: t.inputs,
      expectedOutputs: t.expectedOutputs,
      dependsOn: t.dependsOn,
      permissions: t.permissions,
      budgetMc: t.budgetMc,
      timeoutMs: t.timeoutMs,
      retryPolicy: t.retryPolicy,
      verification: t.verification,
      status: t.status,
      attempts: t.attempts,
      blockedReason: t.blockedReason,
      lastError: t.lastError,
      verificationResults: t.verificationResults,
      evidence: t.evidence,
      startedAt: iso(t.startedAt),
      finishedAt: iso(t.finishedAt),
    })),
    artifacts: artifacts.rows.map((a) => ({
      id: a.id,
      taskId: a.task_id,
      kind: a.kind,
      name: a.name,
      mediaType: a.media_type,
      sha256: a.sha256,
      sizeBytes: a.size_bytes,
      sourceUrl: a.source_url,
      createdAt: a.created_at.toISOString(),
    })),
    events: events.rows.reverse().map((e) => ({
      id: Number(e.id),
      taskKey: e.task_key,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actor: e.actor.startsWith("worker:") ? "worker" : e.actor.startsWith("user:") ? "you" : e.actor,
      reason: e.reason,
      createdAt: e.created_at.toISOString(),
    })),
    receiptId: receipt.rows[0]?.id ?? null,
  };
}

export async function getReceipt(db: Db, ctx: AuthContext, executionId: string): Promise<{ receipt: OutcomeReceipt; sha256: string; raw: string }> {
  const res = await db.query<{ body: string; sha256: string }>(
    "SELECT body, sha256 FROM receipts WHERE execution_id = $1 AND workspace_id = $2",
    [executionId, ctx.workspaceId],
  );
  const row = res.rows[0];
  if (!row) throw notFound("Receipt");
  return { receipt: JSON.parse(row.body) as OutcomeReceipt, sha256: row.sha256, raw: row.body };
}

export async function getArtifact(db: Db, ctx: AuthContext, artifactId: string) {
  const res = await db.query(
    "SELECT id, name, media_type, content, sha256, size_bytes, source_url FROM artifacts WHERE id = $1 AND workspace_id = $2",
    [artifactId, ctx.workspaceId],
  );
  const a = res.rows[0];
  if (!a) throw notFound("Artifact");
  return { id: a.id, name: a.name, mediaType: a.media_type, content: a.content, sha256: a.sha256, sizeBytes: a.size_bytes, sourceUrl: a.source_url };
}
