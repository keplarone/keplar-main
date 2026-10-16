import type { UsageSummary } from "@keplar/contracts";
import type { AuthContext } from "../auth/service.js";
import type { Db } from "../db/pool.js";
import { getAccount } from "./credits.js";
import { getPlan } from "./plans.js";

const LEDGER_LIMIT = 25;

/** Usage for the workspace's current credit period, read from the ledger, tasks and model_calls. */
export async function getUsage(db: Db, ctx: AuthContext): Promise<UsageSummary> {
  const plan = getPlan(ctx.planId);
  const account = await getAccount(db, ctx.workspaceId);
  const start = account.periodStart;
  const params = [ctx.workspaceId, start];

  const [charged, executions, capabilities, models, ledger] = await Promise.all([
    db.query<{ mc: number }>(
      "SELECT COALESCE(SUM(amount_mc), 0) AS mc FROM credit_ledger WHERE workspace_id = $1 AND kind = 'charge' AND created_at >= $2",
      params,
    ),
    db.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM executions WHERE workspace_id = $1 AND created_at >= $2 GROUP BY status",
      params,
    ),
    db.query<{ capability: string; tasks: number; mc: number }>(
      `SELECT capability, count(*)::int AS tasks, COALESCE(SUM(charged_mc), 0) AS mc FROM tasks
        WHERE workspace_id = $1 AND status = 'completed' AND finished_at >= $2
        GROUP BY capability ORDER BY mc DESC, capability`,
      params,
    ),
    db.query<{ provider: string; model: string; calls: number; failures: number; input: number; output: number; usd: number }>(
      `SELECT provider, model, count(*)::int AS calls, count(*) FILTER (WHERE outcome <> 'ok')::int AS failures,
              COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(cost_usd_micros), 0) AS usd
         FROM model_calls WHERE workspace_id = $1 AND created_at >= $2
        GROUP BY provider, model ORDER BY usd DESC, model`,
      params,
    ),
    db.query(
      `SELECT l.id, l.kind, l.amount_mc, l.available_after, l.execution_id, l.memo, l.created_at, e.goal
         FROM credit_ledger l LEFT JOIN executions e ON e.id = l.execution_id AND e.workspace_id = l.workspace_id
        WHERE l.workspace_id = $1 ORDER BY l.id DESC LIMIT ${LEDGER_LIMIT}`,
      [ctx.workspaceId],
    ),
  ]);

  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const byStatus = Object.fromEntries(executions.rows.map((r) => [r.status, r.n]));
  const modelRows = models.rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    calls: r.calls,
    failures: r.failures,
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    costUsdMicros: Number(r.usd),
  }));

  return {
    period: { start, end: end.toISOString().slice(0, 10) },
    credits: { grantedMc: account.grantedMc, availableMc: account.availableMc, reservedMc: account.reservedMc, chargedMc: Number(charged.rows[0]?.mc ?? 0) },
    requests: { used: account.requestsUsed, limit: plan.monthlyRequests },
    executions: { total: executions.rows.reduce((s, r) => s + r.n, 0), byStatus },
    capabilities: capabilities.rows.map((r) => ({ capability: r.capability, tasks: r.tasks, chargedMc: Number(r.mc) })),
    models: modelRows,
    providerCostUsdMicros: modelRows.reduce((s, m) => s + m.costUsdMicros, 0),
    ledger: ledger.rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      amountMc: Number(r.amount_mc),
      availableAfterMc: Number(r.available_after),
      executionId: r.execution_id,
      goal: r.goal,
      memo: r.memo,
      createdAt: r.created_at.toISOString(),
    })),
  };
}
