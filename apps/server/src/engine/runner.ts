import type { ModelTier } from "../billing/plans.js";
import { getPlan } from "../billing/plans.js";
import { taskChargeMc } from "../billing/metering.js";
import { CAPABILITIES } from "../capabilities/catalog.js";
import type { DEFAULT_FETCH_OPTIONS } from "../capabilities/safe-fetch.js";
import type { CapabilityHandlers, CapabilityResult, StoredArtifact } from "../capabilities/types.js";
import type { Db, Tx } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { createModelGateway } from "../models/gateway.js";
import type { ModelProvider } from "../models/types.js";
import { transitionTask } from "../orchestrator/state-machine.js";
import { sha256Hex, verify } from "../verification/verifier.js";
import { advanceDependents, finalizeIfDone } from "./progress.js";
import type { JobRow } from "./queue.js";
import { backoffMs, heartbeat, markCancelled, markDead, markSucceeded, scheduleRetry } from "./queue.js";
import type { ExecutionRow, TaskRow } from "./rows.js";
import { json, loadExecution, toTask } from "./rows.js";

export interface RunnerDeps {
  db: Db;
  workerId: string;
  leaseMs: number;
  handlers: CapabilityHandlers;
  providers: ModelProvider[];
  fetchOptions: typeof DEFAULT_FETCH_OPTIONS;
  log: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

class CancelledError extends Error {}

function isPermanent(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { permanent?: boolean }).permanent === true) return true;
  return (err as { retryable?: boolean }).retryable === false;
}

async function loadTaskForJob(db: Db, job: JobRow): Promise<{ task: TaskRow; exec: ExecutionRow } | null> {
  const t = await db.query("SELECT * FROM tasks WHERE id = $1 AND workspace_id = $2", [job.taskId, job.workspaceId]);
  if (!t.rows[0]) return null;
  const exec = await loadExecution(db, job.workspaceId, job.executionId);
  return exec ? { task: toTask(t.rows[0]), exec } : null;
}

async function upstreamArtifacts(db: Db, task: TaskRow): Promise<StoredArtifact[]> {
  if (task.dependsOn.length === 0) return [];
  const res = await db.query(
    `SELECT a.id, t.key AS task_key, a.name, a.content, a.sha256, a.source_url
       FROM artifacts a JOIN tasks t ON t.id = a.task_id
      WHERE t.execution_id = $1 AND t.key = ANY($2) AND t.status = 'completed' AND a.attempt = t.attempts
      ORDER BY t.ordinal, a.name`,
    [task.executionId, task.dependsOn],
  );
  return res.rows.map((r) => ({ id: r.id, taskKey: r.task_key, name: r.name, content: r.content, sha256: r.sha256, sourceUrl: r.source_url }));
}

/** Finishes the task as cancelled (if it is not already terminal) and finalizes when appropriate. */
async function cancelTask(tx: Tx, task: TaskRow, job: JobRow, actor: string): Promise<void> {
  const current = await tx.query<{ status: TaskRow["status"] }>("SELECT status FROM tasks WHERE id = $1 FOR UPDATE", [task.id]);
  const status = current.rows[0]?.status;
  if (status && ["queued", "running", "verifying", "retrying"].includes(status)) {
    await transitionTask(tx, task, status, "cancelled", { actor, reason: "Execution cancelled", set: { finished_at: new Date() } });
  }
  await markCancelled(tx, job.id);
  await advanceDependents(tx, task.executionId, actor);
  await finalizeIfDone(tx, task.workspaceId, task.executionId, actor);
}

/**
 * Runs one claimed job end to end: start → capability → persist evidence → independent
 * verification → complete / retry / fail, with heartbeats, timeouts, cancellation and fencing.
 */
export async function processJob(deps: RunnerDeps, job: JobRow): Promise<void> {
  const { db, workerId } = deps;
  const actor = `worker:${workerId}`;
  const loaded = await loadTaskForJob(db, job);
  if (!loaded) {
    await markCancelled(db, job.id);
    return;
  }
  const { exec } = loaded;
  let task = loaded.task;

  if (exec.cancelRequested || exec.status !== "running") {
    await withTx(db, (tx) => cancelTask(tx, task, job, actor));
    return;
  }

  // ---- Start (or recover) the attempt -----------------------------------------------------------
  const started = await withTx(db, async (tx) => {
    let from = task.status;
    if (from === "running" || from === "verifying") {
      // A previous worker's lease expired mid-attempt. Record it and take over.
      if (!(await transitionTask(tx, task, from, "retrying", { actor, reason: "Previous worker stopped responding; lease expired", set: { last_error: "Worker lease expired" } }))) return false;
      from = "retrying";
    }
    if (job.attempts > job.maxAttempts) {
      await transitionTask(tx, task, from, "failed", { actor, reason: "Attempts exhausted", set: { finished_at: new Date(), last_error: task.lastError ?? "Attempts exhausted" } });
      await markDead(tx, job, workerId, "Attempts exhausted");
      await advanceDependents(tx, task.executionId, actor);
      await finalizeIfDone(tx, task.workspaceId, task.executionId, actor);
      return false;
    }
    if (from !== "queued" && from !== "retrying") return false;
    return transitionTask(tx, task, from, "running", {
      actor,
      reason: `Attempt ${job.attempts} of ${job.maxAttempts}`,
      set: { attempts: job.attempts, started_at: task.startedAt ?? new Date() },
    });
  });
  if (!started) return;
  task = { ...task, status: "running", attempts: job.attempts };

  // ---- Run the capability under heartbeat, timeout and cancellation ------------------------------
  const controller = new AbortController();
  let fencedOut = false;
  const beat = setInterval(() => {
    heartbeat(db, job, workerId, deps.leaseMs)
      .then(({ owned, cancelRequested }) => {
        if (!owned) {
          fencedOut = true;
          controller.abort(new CancelledError("Lease lost"));
        } else if (cancelRequested) {
          controller.abort(new CancelledError("Execution cancelled"));
        }
      })
      .catch((e) => deps.log("warn", "heartbeat failed", { jobId: job.id, err: (e as Error).message }));
  }, Math.max(500, Math.floor(deps.leaseMs / 3)));

  const timeoutSignal = AbortSignal.timeout(task.timeoutMs);
  const signal = AbortSignal.any([controller.signal, timeoutSignal]);
  let result: CapabilityResult | null = null;
  let failure: unknown = null;
  try {
    const handler = task.capability ? deps.handlers[task.capability] : undefined;
    if (!handler) throw Object.assign(new Error(`No handler for capability ${task.capability}`), { permanent: true });
    const plan = getPlan(exec.planId);
    const allowedTiers: ModelTier[] = plan.modelTiers;
    const models = task.permissions.includes("model.generate") && deps.providers.length > 0
      ? createModelGateway(db, deps.providers, { workspaceId: task.workspaceId, executionId: task.executionId, taskId: task.id, allowedTiers, signal })
      : null;
    const run = handler({
      goal: exec.goal,
      inputs: task.inputs,
      taskKey: task.key,
      signal,
      upstream: await upstreamArtifacts(db, task),
      models,
      fetchOptions: deps.fetchOptions,
    });
    // Handlers should honour the signal; this race guarantees we stop waiting even if one does not.
    result = await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (err) {
    failure = err;
  } finally {
    clearInterval(beat);
  }
  if (fencedOut) {
    deps.log("warn", "lost lease; abandoning attempt", { jobId: job.id, taskId: task.id });
    return;
  }
  if (failure instanceof CancelledError || (failure && controller.signal.aborted && !timeoutSignal.aborted)) {
    await withTx(db, (tx) => cancelTask(tx, task, job, actor));
    return;
  }
  if (failure) {
    const message = timeoutSignal.aborted ? `Timed out after ${task.timeoutMs} ms` : (failure as Error).message ?? String(failure);
    await handleFailure(deps, job, task, "running", message, isPermanent(failure) && !timeoutSignal.aborted);
    return;
  }

  // ---- Persist evidence atomically with the transition to verifying ------------------------------
  const spec = CAPABILITIES[task.capability!];
  const chargedMc = taskChargeMc(spec.baseCostMc, result!.providerCostUsd, task.budgetMc);
  const persisted = await withTx(db, async (tx) => {
    const ok = await transitionTask(tx, task, "running", "verifying", {
      actor,
      reason: "Capability finished; verifying output",
      expectAttempts: job.attempts,
      set: { outputs: json(result!.outputs), evidence: json(result!.evidence), charged_mc: chargedMc },
    });
    if (!ok) return false;
    for (const a of result!.artifacts) {
      await tx.query(
        `INSERT INTO artifacts (workspace_id, execution_id, task_id, attempt, kind, name, media_type, content, sha256, size_bytes, source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (task_id, attempt, name) DO NOTHING`,
        [task.workspaceId, task.executionId, task.id, job.attempts, a.kind, a.name, a.mediaType, a.content, sha256Hex(a.content), Buffer.byteLength(a.content), a.sourceUrl ?? null],
      );
    }
    return true;
  });
  if (!persisted) return;

  // ---- Independent verification against what was actually stored ---------------------------------
  const stored = await db.query(`SELECT name, content, sha256, source_url FROM artifacts WHERE task_id = $1 AND attempt = $2`, [task.id, job.attempts]);
  const upstream = await upstreamArtifacts(db, task);
  const outcome = verify({
    criteria: task.verification,
    artifacts: stored.rows.map((r) => ({ name: r.name, content: r.content, sha256: r.sha256, sourceUrl: r.source_url })),
    outputs: result!.outputs,
    upstreamSources: upstream.filter((a) => a.sourceUrl).map((a) => ({ url: a.sourceUrl! })),
  });

  if (!outcome.passed) {
    const failed = outcome.checks.filter((c) => !c.passed).map((c) => c.detail).join("; ");
    await withTx(db, (tx) => tx.query("UPDATE tasks SET verification_results = $2 WHERE id = $1", [task.id, json(outcome.checks)]));
    // Repair loop: a failed verification gets a bounded retry, never an infinite one.
    await handleFailure(deps, job, { ...task, status: "verifying" }, "verifying", `Verification failed: ${failed}`, false);
    return;
  }

  await withTx(db, async (tx) => {
    const ok = await transitionTask(tx, task, "verifying", "completed", {
      actor,
      reason: `Verified: ${outcome.checks.length} checks passed`,
      expectAttempts: job.attempts,
      set: { verification_results: json(outcome.checks), finished_at: new Date(), last_error: null },
    });
    if (!ok) return;
    await markSucceeded(tx, job, workerId);
    await advanceDependents(tx, task.executionId, actor);
    await finalizeIfDone(tx, task.workspaceId, task.executionId, actor);
  });
  deps.log("info", "task completed", { taskId: task.id, executionId: task.executionId, attempt: job.attempts });
}

async function handleFailure(deps: RunnerDeps, job: JobRow, task: TaskRow, from: "running" | "verifying", message: string, permanent: boolean): Promise<void> {
  const { db, workerId } = deps;
  const actor = `worker:${workerId}`;
  const canRetry = !permanent && job.attempts < job.maxAttempts;
  await withTx(db, async (tx) => {
    if (canRetry) {
      const delay = backoffMs(job.attempts, task.retryPolicy.baseDelayMs, task.retryPolicy.maxDelayMs);
      const ok = await transitionTask(tx, task, from, "retrying", {
        actor,
        reason: `${message} — retrying in ${Math.round(delay / 100) / 10}s`,
        expectAttempts: job.attempts,
        set: { last_error: message.slice(0, 1000) },
      });
      if (ok) await scheduleRetry(tx, job, workerId, delay, message.slice(0, 1000));
      return;
    }
    const ok = await transitionTask(tx, task, from, "failed", {
      actor,
      reason: permanent ? `${message} (not retryable)` : `${message} (attempts exhausted)`,
      expectAttempts: job.attempts,
      set: { last_error: message.slice(0, 1000), finished_at: new Date() },
    });
    if (!ok) return;
    await markDead(tx, job, workerId, message.slice(0, 1000));
    await advanceDependents(tx, task.executionId, actor);
    await finalizeIfDone(tx, task.workspaceId, task.executionId, actor);
  });
  deps.log("warn", canRetry ? "task will retry" : "task failed", { taskId: task.id, attempt: job.attempts, error: message });
}
