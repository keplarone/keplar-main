import { AppError } from "../errors.js";
import type { Db, Queryable, Tx } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { getPlan } from "./plans.js";

/**
 * Credit accounting. Balances live in credit_accounts; every movement is an append-only ledger row
 * with a unique idempotency key. Movements lock the account row (SELECT … FOR UPDATE), and CHECK
 * constraints forbid negative balances, so concurrent requests cannot spend the same credits twice.
 */

export interface CreditAccount {
  workspaceId: string;
  periodStart: string;
  grantedMc: number;
  availableMc: number;
  reservedMc: number;
  requestsUsed: number;
}

export class InsufficientCreditsError extends AppError {
  constructor(requiredMc: number, availableMc: number) {
    super(402, "insufficient_credits", "Not enough execution credits for this plan. Upgrade or wait for your next period.", {
      requiredMc,
      availableMc,
    });
  }
}

function currentPeriodStart(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function toAccount(row: Record<string, unknown>): CreditAccount {
  return {
    workspaceId: row.workspace_id as string,
    periodStart: (row.period_start as Date | string) instanceof Date
      ? (row.period_start as Date).toISOString().slice(0, 10)
      : String(row.period_start),
    grantedMc: Number(row.granted_mc),
    availableMc: Number(row.available_mc),
    reservedMc: Number(row.reserved_mc),
    requestsUsed: Number(row.requests_used),
  };
}

async function ledger(
  tx: Queryable,
  workspaceId: string,
  executionId: string | null,
  kind: "grant" | "reserve" | "release" | "charge",
  amountMc: number,
  after: { availableMc: number; reservedMc: number },
  idempotencyKey: string,
  memo: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO credit_ledger (workspace_id, execution_id, kind, amount_mc, available_after, reserved_after, idempotency_key, memo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [workspaceId, executionId, kind, amountMc, after.availableMc, after.reservedMc, idempotencyKey, memo],
  );
}

export async function openAccount(tx: Tx, workspaceId: string, planId: string): Promise<void> {
  const plan = getPlan(planId);
  const period = currentPeriodStart();
  await tx.query(
    `INSERT INTO credit_accounts (workspace_id, period_start, granted_mc, available_mc, reserved_mc)
     VALUES ($1, $2, $3, $3, 0)`,
    [workspaceId, period, plan.monthlyExecutionCreditsMc],
  );
  await ledger(tx, workspaceId, null, "grant", plan.monthlyExecutionCreditsMc,
    { availableMc: plan.monthlyExecutionCreditsMc, reservedMc: 0 }, `grant:${workspaceId}:${period}`, `${plan.name} monthly grant`);
}

/**
 * Locks the account and rolls it into the current period if needed. Reserved credits carry over
 * (they belong to running executions); available credits reset to the plan grant.
 */
async function lockAccount(tx: Tx, workspaceId: string): Promise<CreditAccount> {
  const res = await tx.query(
    `SELECT a.*, w.plan_id FROM credit_accounts a JOIN workspaces w ON w.id = a.workspace_id
     WHERE a.workspace_id = $1 FOR UPDATE OF a`,
    [workspaceId],
  );
  const row = res.rows[0];
  if (!row) throw new AppError(500, "credit_account_missing", "Credit account missing");
  const account = toAccount(row);
  const period = currentPeriodStart();
  if (account.periodStart < period) {
    const plan = getPlan(row.plan_id as string);
    await tx.query(
      `UPDATE credit_accounts SET period_start = $2, granted_mc = $3, available_mc = $3, requests_used = 0, updated_at = now()
       WHERE workspace_id = $1`,
      [workspaceId, period, plan.monthlyExecutionCreditsMc],
    );
    await ledger(tx, workspaceId, null, "grant", plan.monthlyExecutionCreditsMc,
      { availableMc: plan.monthlyExecutionCreditsMc, reservedMc: account.reservedMc }, `grant:${workspaceId}:${period}`, `${plan.name} monthly grant`);
    return { ...account, periodStart: period, grantedMc: plan.monthlyExecutionCreditsMc, availableMc: plan.monthlyExecutionCreditsMc, requestsUsed: 0 };
  }
  return account;
}

export async function getAccount(db: Db, workspaceId: string): Promise<CreditAccount> {
  return withTx(db, (tx) => lockAccount(tx, workspaceId));
}

/** Counts one planning request against the monthly request quota. Throws 429 when the quota is spent. */
export async function consumeRequest(tx: Tx, workspaceId: string, limit: number): Promise<void> {
  const account = await lockAccount(tx, workspaceId);
  if (account.requestsUsed >= limit) {
    throw new AppError(429, "request_quota_exhausted", "You have used every request included in your plan this month.", {
      used: account.requestsUsed,
      limit,
    });
  }
  await tx.query("UPDATE credit_accounts SET requests_used = requests_used + 1, updated_at = now() WHERE workspace_id = $1", [workspaceId]);
}

/** Moves credits from available to reserved for an execution. Idempotent per execution. */
export async function reserve(tx: Tx, workspaceId: string, executionId: string, amountMc: number): Promise<void> {
  const account = await lockAccount(tx, workspaceId);
  const key = `reserve:${executionId}`;
  const existing = await tx.query("SELECT 1 FROM credit_ledger WHERE idempotency_key = $1", [key]);
  if (existing.rowCount) return;
  if (account.availableMc < amountMc) throw new InsufficientCreditsError(amountMc, account.availableMc);
  const after = { availableMc: account.availableMc - amountMc, reservedMc: account.reservedMc + amountMc };
  await tx.query(
    "UPDATE credit_accounts SET available_mc = $2, reserved_mc = $3, updated_at = now() WHERE workspace_id = $1",
    [workspaceId, after.availableMc, after.reservedMc],
  );
  await ledger(tx, workspaceId, executionId, "reserve", amountMc, after, key, "Reserved for approved execution");
}

/**
 * Settles an execution's reservation: charges the actual usage (capped at the reservation)
 * and releases the remainder. Idempotent per execution.
 */
export async function settle(
  tx: Tx,
  workspaceId: string,
  executionId: string,
  reservedMc: number,
  actualMc: number,
): Promise<{ chargedMc: number; releasedMc: number }> {
  const account = await lockAccount(tx, workspaceId);
  const chargeKey = `charge:${executionId}`;
  const existing = await tx.query<{ amount_mc: number }>("SELECT amount_mc FROM credit_ledger WHERE idempotency_key = $1", [chargeKey]);
  if (existing.rows[0]) {
    const charged = Number(existing.rows[0].amount_mc);
    return { chargedMc: charged, releasedMc: reservedMc - charged };
  }
  const chargedMc = Math.min(Math.max(actualMc, 0), reservedMc);
  const releasedMc = reservedMc - chargedMc;
  const reservedAfter = account.reservedMc - reservedMc;
  if (reservedAfter < 0) throw new AppError(500, "ledger_inconsistent", "Reservation exceeds reserved balance");
  const afterCharge = { availableMc: account.availableMc, reservedMc: account.reservedMc - chargedMc };
  const afterRelease = { availableMc: account.availableMc + releasedMc, reservedMc: reservedAfter };
  await tx.query(
    "UPDATE credit_accounts SET available_mc = $2, reserved_mc = $3, updated_at = now() WHERE workspace_id = $1",
    [workspaceId, afterRelease.availableMc, afterRelease.reservedMc],
  );
  await ledger(tx, workspaceId, executionId, "charge", chargedMc, afterCharge, chargeKey, "Charged for actual usage");
  await ledger(tx, workspaceId, executionId, "release", releasedMc, afterRelease, `release:${executionId}`, "Unused reservation released");
  return { chargedMc, releasedMc };
}
