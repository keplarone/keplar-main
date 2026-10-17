-- Credits that a user can spend on OpenRouter.
--
-- The ledger is the source of truth. A user's OpenRouter key limit is always
-- set to SUM(credit_ledger.amount_usd) for that user, so re-running a sync is
-- harmless and a webhook that is delivered twice can never grant twice.

create table if not exists customers (
  whop_user_id                text primary key,
  whop_member_id              text,
  openrouter_key_hash         text unique,
  openrouter_key_enc          text,           -- AES-256-GCM, see lib/crypto.ts

  autotopup_enabled           boolean not null default false,
  autotopup_threshold_usd     numeric(10, 2) not null default 1.00,
  autotopup_pack_plan_id      text,           -- Whop plan id of the credit pack to buy
  autotopup_payment_method_id text,           -- payt_..., saved via setup-mode checkout
  autotopup_pending_payment_id text,          -- set while a charge is in flight
  autotopup_pending_since     timestamptz,
  autotopup_last_error        text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists credit_ledger (
  id            bigserial primary key,
  whop_user_id  text not null references customers (whop_user_id),
  -- Whop payment id (pay_...) for grants, refund id for refunds. Unique so
  -- duplicate webhook deliveries are no-ops.
  source_id     text not null unique,
  kind          text not null check (kind in ('plan', 'pack', 'auto_topup', 'refund', 'adjustment')),
  amount_usd    numeric(10, 2) not null,
  -- What the buyer paid, used to refund credits proportionally.
  paid_amount   numeric(12, 2),
  related_payment_id text,
  created_at    timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on credit_ledger (whop_user_id, created_at);
create index if not exists credit_ledger_related_idx on credit_ledger (related_payment_id);
