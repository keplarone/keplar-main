import type { ModelTier } from "../billing/plans.js";
import type { Queryable } from "../db/pool.js";
import type { ModelGateway } from "../capabilities/types.js";
import { costUsd } from "./registry.js";
import { routeModel } from "./router.js";
import type { ModelProvider } from "./types.js";
import { ModelOutputError } from "./types.js";

export interface GatewayScope {
  workspaceId: string;
  executionId: string;
  taskId: string;
  allowedTiers: ModelTier[];
  signal: AbortSignal;
}

/**
 * Per-task model gateway: routes to the cheapest suitable model the plan allows, falls back to the
 * next candidate on retryable provider errors, and records every call (success or failure) with
 * actual token usage and cost.
 */
export function createModelGateway(db: Queryable, providers: ModelProvider[], scope: GatewayScope): ModelGateway {
  return {
    async generate(req) {
      const candidates = routeModel({
        preferredTier: req.preferredTier,
        allowedTiers: scope.allowedTiers,
        availableProviders: providers.map((p) => p.name),
      });
      if (candidates.length === 0) throw new ModelOutputError("No model available for this plan and task", false);
      let lastError: unknown;
      for (const spec of candidates) {
        const provider = providers.find((p) => p.name === spec.provider)!;
        const started = Date.now();
        try {
          const out = await provider.generate(spec.id, { system: req.system, prompt: req.prompt, maxTokens: req.maxTokens, signal: scope.signal });
          const cost = costUsd(spec, out.inputTokens, out.outputTokens);
          await record(db, scope, spec.provider, spec.id, out.inputTokens, out.outputTokens, cost, Date.now() - started, "ok", null);
          return { text: out.text, model: spec.id, costUsd: cost };
        } catch (err) {
          await record(db, scope, spec.provider, spec.id, 0, 0, 0, Date.now() - started, "error", (err as Error).message.slice(0, 500));
          lastError = err;
          if (err instanceof ModelOutputError && !err.retryable) throw err;
        }
      }
      throw lastError;
    },
  };
}

async function record(
  db: Queryable,
  scope: GatewayScope,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  latencyMs: number,
  outcome: string,
  error: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO model_calls (workspace_id, execution_id, task_id, provider, model, input_tokens, output_tokens, cost_usd_micros, latency_ms, outcome, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [scope.workspaceId, scope.executionId, scope.taskId, provider, model, inputTokens, outputTokens, Math.round(cost * 1_000_000), latencyMs, outcome, error],
  );
}
