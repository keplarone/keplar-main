import type { Whop } from "@whop/sdk";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { createKey, getKey, setKeyLimit } from "./openrouter";
import { grantForPlan } from "./plans";

export type GrantKind = "plan" | "pack" | "auto_topup";

export interface CreditGrant {
  kind: GrantKind;
  amountUsd: number;
}

const toCents = (usd: number) => Math.round(usd * 100);
const fromCents = (cents: number) => cents / 100;

/** Works out how much OpenRouter credit a successful Whop payment buys. */
export function creditsForPayment(payment: Whop.Payment): CreditGrant | undefined {
  const items = payment.line_items?.length
    ? payment.line_items.map((item) => ({ planId: item.plan_id, quantity: item.quantity || 1 }))
    : [{ planId: payment.plan_id, quantity: 1 }];

  let cents = 0;
  let kind: GrantKind | undefined;
  for (const { planId, quantity } of items) {
    const grant = planId ? grantForPlan(planId) : undefined;
    if (!grant) continue;
    cents += toCents(grant.amountUsd) * quantity;
    kind ??= grant.kind;
  }
  if (!kind || cents <= 0) return undefined;
  if (payment.metadata?.purpose === "auto_topup") kind = "auto_topup";
  return { kind, amountUsd: fromCents(cents) };
}

export function paidAmount(payment: Whop.Payment): number {
  return Number(payment.total?.amount ?? 0);
}

async function ensureCustomer(whopUserId: string, memberId: string | null) {
  await db()`
    insert into customers (whop_user_id, whop_member_id)
    values (${whopUserId}, ${memberId})
    on conflict (whop_user_id) do update
      set whop_member_id = coalesce(excluded.whop_member_id, customers.whop_member_id),
          updated_at = now()`;
}

/**
 * Handles `payment.succeeded`: records the grant once and raises the user's
 * OpenRouter key limit. Safe to call any number of times for the same payment.
 */
export async function grantForPayment(payment: Whop.Payment): Promise<"granted" | "ignored"> {
  const grant = creditsForPayment(payment);
  const userId = payment.user?.id;
  // Free trials and 100% promo codes produce $0 payments; they don't buy credit.
  if (!grant || !userId || paidAmount(payment) <= 0) return "ignored";

  await ensureCustomer(userId, payment.member_id);
  await db()`
    insert into credit_ledger (whop_user_id, source_id, kind, amount_usd, paid_amount)
    values (${userId}, ${payment.id}, ${grant.kind}, ${grant.amountUsd}, ${paidAmount(payment)})
    on conflict (source_id) do nothing`;
  await db()`
    update customers
       set autotopup_pending_payment_id = null, autotopup_pending_since = null, autotopup_last_error = null
     where whop_user_id = ${userId} and autotopup_pending_payment_id = ${payment.id}`;
  await syncKeyLimit(userId);
  return "granted";
}

/** Handles `refund.created` / `refund.updated`: takes back a proportional share of the credit. */
export async function revokeForRefund(refund: Whop.Refund): Promise<"revoked" | "ignored"> {
  if (refund.status !== "succeeded") return "ignored";

  const [grant] = await db()<{ whop_user_id: string; amount_usd: string; paid_amount: string | null }[]>`
    select whop_user_id, amount_usd, paid_amount from credit_ledger
     where source_id = ${refund.payment_id} and kind in ('plan', 'pack', 'auto_topup')`;
  if (!grant) return "ignored";

  const [{ refunded }] = await db()<{ refunded: string }[]>`
    select coalesce(-sum(amount_usd), 0) as refunded from credit_ledger
     where related_payment_id = ${refund.payment_id} and kind = 'refund' and source_id <> ${refund.id}`;

  const grantedCents = toCents(Number(grant.amount_usd));
  const paid = Number(grant.paid_amount ?? 0);
  const refundAmount = Number(refund.amount?.amount ?? refund.original_amount.amount);
  const share = paid > 0 ? Math.min(1, refundAmount / paid) : 1;
  const cents = Math.min(Math.round(grantedCents * share), grantedCents - toCents(Number(refunded)));
  if (cents <= 0) return "ignored";

  await db()`
    insert into credit_ledger (whop_user_id, source_id, kind, amount_usd, related_payment_id)
    values (${grant.whop_user_id}, ${refund.id}, 'refund', ${-fromCents(cents)}, ${refund.payment_id})
    on conflict (source_id) do nothing`;
  await syncKeyLimit(grant.whop_user_id);
  return "revoked";
}

/**
 * Sets the user's OpenRouter key limit to the total credit in the ledger,
 * creating the key on first use. The row lock serialises concurrent syncs so
 * an older total can never overwrite a newer one.
 */
export async function syncKeyLimit(whopUserId: string): Promise<number> {
  return db().begin(async (tx) => {
    const [customer] = await tx<{ openrouter_key_hash: string | null }[]>`
      select openrouter_key_hash from customers where whop_user_id = ${whopUserId} for update`;
    if (!customer) throw new Error(`Unknown customer ${whopUserId}`);

    const [{ total }] = await tx<{ total: string }[]>`
      select coalesce(sum(amount_usd), 0) as total from credit_ledger where whop_user_id = ${whopUserId}`;
    const limit = Math.max(0, Number(total));

    if (customer.openrouter_key_hash) {
      await setKeyLimit(customer.openrouter_key_hash, limit);
    } else {
      const created = await createKey(`keplar:${whopUserId}`, limit);
      await tx`
        update customers
           set openrouter_key_hash = ${created.data.hash}, openrouter_key_enc = ${encrypt(created.key)}, updated_at = now()
         where whop_user_id = ${whopUserId}`;
    }
    return limit;
  });
}

export interface Balance {
  limitUsd: number;
  usageUsd: number;
  remainingUsd: number;
}

export async function getBalance(whopUserId: string): Promise<Balance> {
  const [customer] = await db()<{ openrouter_key_hash: string | null }[]>`
    select openrouter_key_hash from customers where whop_user_id = ${whopUserId}`;
  if (!customer?.openrouter_key_hash) return { limitUsd: 0, usageUsd: 0, remainingUsd: 0 };
  const key = await getKey(customer.openrouter_key_hash);
  const limitUsd = key.limit ?? 0;
  return { limitUsd, usageUsd: key.usage, remainingUsd: key.limit_remaining ?? Math.max(0, limitUsd - key.usage) };
}

/** The user's own OpenRouter API key, for server-side calls only. Never send it to the browser. */
export async function getUserApiKey(whopUserId: string): Promise<string | undefined> {
  const [customer] = await db()<{ openrouter_key_enc: string | null }[]>`
    select openrouter_key_enc from customers where whop_user_id = ${whopUserId}`;
  return customer?.openrouter_key_enc ? decrypt(customer.openrouter_key_enc) : undefined;
}
