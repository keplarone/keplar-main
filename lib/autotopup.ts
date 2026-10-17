import type { Whop } from "@whop/sdk";
import { randomUUID } from "node:crypto";
import { getBalance } from "./credits";
import { db } from "./db";
import { env, optionalEnv } from "./env";
import { creditPacks } from "./plans";
import { whop } from "./whop";

// Auto top-up: when a user's remaining OpenRouter credit falls below their
// threshold, charge their saved card for a credit pack. The resulting
// `payment.succeeded` webhook grants the credit through the normal path.

// Don't fire another charge while one is in flight (or just failed to start).
const PENDING_WINDOW_MS = 30 * 60 * 1000;

function maxPerDay(): number {
  return Number(optionalEnv("AUTOTOPUP_MAX_PER_DAY") ?? 3);
}

export interface AutoTopUpSettings {
  enabled: boolean;
  thresholdUsd: number;
  packPlanId: string;
}

export function validateSettings(input: unknown): AutoTopUpSettings {
  const { enabled, thresholdUsd, packPlanId } = (input ?? {}) as Record<string, unknown>;
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  if (typeof thresholdUsd !== "number" || !(thresholdUsd >= 0.5 && thresholdUsd <= 100)) {
    throw new Error("thresholdUsd must be between 0.5 and 100");
  }
  if (typeof packPlanId !== "string" || !(packPlanId in creditPacks())) throw new Error("Unknown credit pack");
  return { enabled, thresholdUsd, packPlanId };
}

interface CustomerRow {
  whop_member_id: string | null;
  autotopup_enabled: boolean;
  autotopup_threshold_usd: string;
  autotopup_pack_plan_id: string | null;
  autotopup_payment_method_id: string | null;
  autotopup_pending_payment_id: string | null;
  autotopup_pending_since: Date | null;
  autotopup_last_error: string | null;
}

export async function getSettings(whopUserId: string) {
  const [c] = await db()<CustomerRow[]>`select * from customers where whop_user_id = ${whopUserId}`;
  return {
    enabled: c?.autotopup_enabled ?? false,
    thresholdUsd: Number(c?.autotopup_threshold_usd ?? 1),
    packPlanId: c?.autotopup_pack_plan_id ?? null,
    hasPaymentMethod: Boolean(c?.autotopup_payment_method_id),
    lastError: c?.autotopup_last_error ?? null,
  };
}

/**
 * Saves the user's settings. Enabling without a saved card returns a Whop
 * setup-mode checkout URL; the card is attached by `setup_intent.succeeded`.
 */
export async function updateSettings(
  whopUserId: string,
  settings: AutoTopUpSettings,
): Promise<{ setupUrl?: string }> {
  await db()`
    insert into customers (whop_user_id, autotopup_threshold_usd, autotopup_pack_plan_id)
    values (${whopUserId}, ${settings.thresholdUsd}, ${settings.packPlanId})
    on conflict (whop_user_id) do update
      set autotopup_threshold_usd = excluded.autotopup_threshold_usd,
          autotopup_pack_plan_id = excluded.autotopup_pack_plan_id,
          updated_at = now()`;

  const [c] = await db()<CustomerRow[]>`select * from customers where whop_user_id = ${whopUserId}`;
  if (!settings.enabled || c.autotopup_payment_method_id) {
    await db()`
      update customers set autotopup_enabled = ${settings.enabled}, autotopup_last_error = null, updated_at = now()
       where whop_user_id = ${whopUserId}`;
    return {};
  }

  const checkout = await whop().checkoutConfigurations.create({
    account_id: env("WHOP_COMPANY_ID"),
    mode: "setup",
    redirect_url: `${env("APP_URL")}/credits?autotopup=saved`,
    metadata: { purpose: "auto_topup_setup", whop_user_id: whopUserId },
  });
  if (!checkout.purchase_url) throw new Error("Whop did not return a checkout URL");
  return { setupUrl: checkout.purchase_url };
}

/** `setup_intent.succeeded`: remember the saved card and switch auto top-up on. */
export async function handleSetupIntentSucceeded(intent: Whop.SetupIntent): Promise<"saved" | "ignored"> {
  const userId = intent.user?.id;
  if (intent.metadata?.purpose !== "auto_topup_setup" || !userId || !intent.payment_method_id) return "ignored";
  // The checkout was created for one user; don't let another user's card land on it.
  if (intent.metadata.whop_user_id !== userId) return "ignored";

  await db()`
    update customers
       set autotopup_payment_method_id = ${intent.payment_method_id},
           whop_member_id = coalesce(${intent.member_id}, whop_member_id),
           autotopup_enabled = true,
           autotopup_last_error = null,
           updated_at = now()
     where whop_user_id = ${userId}`;
  return "saved";
}

/** `payment.failed` / `payment.requires_action` on an auto top-up: stop and tell the user. */
export async function handleTopUpFailed(payment: Whop.Payment): Promise<"disabled" | "ignored"> {
  const userId = payment.user?.id;
  if (payment.metadata?.purpose !== "auto_topup" || !userId) return "ignored";
  const reason =
    payment.recovery_url
      ? `Your bank asked to verify the auto top-up charge: ${payment.recovery_url}`
      : payment.failure_message ?? "Auto top-up charge failed";
  await db()`
    update customers
       set autotopup_enabled = false,
           autotopup_pending_payment_id = null,
           autotopup_pending_since = null,
           autotopup_last_error = ${reason},
           updated_at = now()
     where whop_user_id = ${userId}`;
  return "disabled";
}

export type TopUpResult = "charged" | "not_needed" | "not_enabled" | "pending" | "daily_cap" | "error";

/** Charges the user's saved card for their chosen pack if they are below their threshold. */
export async function maybeTopUp(whopUserId: string): Promise<TopUpResult> {
  return db().begin(async (tx) => {
    const [c] = await tx<CustomerRow[]>`select * from customers where whop_user_id = ${whopUserId} for update`;
    if (!c?.autotopup_enabled || !c.autotopup_payment_method_id || !c.whop_member_id || !c.autotopup_pack_plan_id) {
      return "not_enabled";
    }
    if (c.autotopup_pending_since && Date.now() - c.autotopup_pending_since.getTime() < PENDING_WINDOW_MS) {
      return "pending";
    }
    if (!(c.autotopup_pack_plan_id in creditPacks())) return "not_enabled";

    const [{ count }] = await tx<{ count: number }[]>`
      select count(*)::int as count from credit_ledger
       where whop_user_id = ${whopUserId} and kind = 'auto_topup' and created_at > now() - interval '1 day'`;
    if (count >= maxPerDay()) return "daily_cap";

    const balance = await getBalance(whopUserId);
    if (balance.remainingUsd >= Number(c.autotopup_threshold_usd)) return "not_needed";

    try {
      const payment = await whop().payments.create(
        {
          account_id: env("WHOP_COMPANY_ID"),
          plan_id: c.autotopup_pack_plan_id,
          member_id: c.whop_member_id,
          payment_method_id: c.autotopup_payment_method_id,
          off_session: true,
          metadata: { purpose: "auto_topup", whop_user_id: whopUserId },
        },
        { idempotencyKey: `autotopup:${whopUserId}:${randomUUID()}` },
      );
      await tx`
        update customers
           set autotopup_pending_payment_id = ${payment.id}, autotopup_pending_since = now(), updated_at = now()
         where whop_user_id = ${whopUserId}`;
      return "charged";
    } catch (err) {
      // Back off for the pending window rather than retrying on every request.
      await tx`
        update customers
           set autotopup_pending_payment_id = null, autotopup_pending_since = now(),
               autotopup_last_error = ${err instanceof Error ? err.message : String(err)}, updated_at = now()
         where whop_user_id = ${whopUserId}`;
      return "error";
    }
  });
}

/** Cron entry point: checks every user with auto top-up switched on. */
export async function runAutoTopUps(limit = 500): Promise<Record<TopUpResult, number>> {
  const rows = await db()<{ whop_user_id: string }[]>`
    select whop_user_id from customers
     where autotopup_enabled and autotopup_payment_method_id is not null
     order by updated_at limit ${limit}`;
  const tally: Record<TopUpResult, number> = {
    charged: 0, not_needed: 0, not_enabled: 0, pending: 0, daily_cap: 0, error: 0,
  };
  for (const { whop_user_id } of rows) {
    try {
      tally[await maybeTopUp(whop_user_id)]++;
    } catch (err) {
      console.error("auto top-up check failed", whop_user_id, err);
      tally.error++;
    }
  }
  return tally;
}
