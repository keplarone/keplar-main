-- Keplar One initial schema: identity, tenancy, credits, execution engine, evidence.
-- Every tenant-owned row carries workspace_id; every query in the application filters on it.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  plan_id    text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   bytea NOT NULL UNIQUE,          -- SHA-256 of the opaque cookie token; the token itself is never stored
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Balances are stored in millicredits (1 execution credit = 1000 mc) so weighted metering stays integral.
CREATE TABLE credit_accounts (
  workspace_id  uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  granted_mc    bigint NOT NULL CHECK (granted_mc >= 0),
  available_mc  bigint NOT NULL CHECK (available_mc >= 0),
  reserved_mc   bigint NOT NULL CHECK (reserved_mc >= 0),
  requests_used integer NOT NULL DEFAULT 0 CHECK (requests_used >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id              bigserial PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id    uuid,
  kind            text NOT NULL CHECK (kind IN ('grant', 'reserve', 'release', 'charge')),
  amount_mc       bigint NOT NULL CHECK (amount_mc >= 0),
  available_after bigint NOT NULL,
  reserved_after  bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_workspace_idx ON credit_ledger (workspace_id, created_at);

CREATE TABLE executions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL REFERENCES users(id),
  goal             text NOT NULL,
  intent           jsonb NOT NULL,
  status           text NOT NULL CHECK (status IN ('awaiting_approval','running','completed','partially_completed','blocked','failed','cancelled')),
  planner          text NOT NULL,
  plan_hash        text NOT NULL,
  estimated_mc     bigint NOT NULL DEFAULT 0,
  reserved_mc      bigint NOT NULL DEFAULT 0,
  charged_mc       bigint NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  approved_by      uuid REFERENCES users(id),
  approved_at      timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executions_workspace_idx ON executions (workspace_id, created_at DESC);

CREATE TABLE tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id         uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  key                  text NOT NULL,
  ordinal              integer NOT NULL,
  title                text NOT NULL,
  description          text NOT NULL,
  capability           text,
  inputs               jsonb NOT NULL DEFAULT '{}',
  expected_outputs     jsonb NOT NULL DEFAULT '[]',
  depends_on           text[] NOT NULL DEFAULT '{}',
  permissions          text[] NOT NULL DEFAULT '{}',
  budget_mc            bigint NOT NULL,
  timeout_ms           integer NOT NULL,
  retry_policy         jsonb NOT NULL,
  verification         jsonb NOT NULL DEFAULT '[]',
  verification_results jsonb NOT NULL DEFAULT '[]',
  status               text NOT NULL CHECK (status IN ('created','planned','awaiting_approval','queued','running','verifying','retrying','completed','blocked','failed','cancelled')),
  attempts             integer NOT NULL DEFAULT 0,
  outputs              jsonb,
  evidence             jsonb NOT NULL DEFAULT '[]',
  charged_mc           bigint NOT NULL DEFAULT 0,
  blocked_reason       text,
  last_error           text,
  started_at           timestamptz,
  finished_at          timestamptz,
  UNIQUE (execution_id, key)
);
CREATE INDEX tasks_execution_idx ON tasks (execution_id, ordinal);

-- Append-only audit trail of every execution/task state transition.
CREATE TABLE execution_events (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  actor        text NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_events_execution_idx ON execution_events (execution_id, id);

-- Durable job queue. Claimed with FOR UPDATE SKIP LOCKED; leases expire so crashed workers' jobs are reclaimed.
CREATE TABLE jobs (
  id               bigserial PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id     uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  status           text NOT NULL CHECK (status IN ('queued','leased','succeeded','dead','cancelled')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL,
  run_after        timestamptz NOT NULL DEFAULT now(),
  lease_owner      text,
  lease_expires_at timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claimable_idx ON jobs (run_after) WHERE status = 'queued';
CREATE INDEX jobs_leased_idx ON jobs (lease_expires_at) WHERE status = 'leased';

CREATE TABLE artifacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt      integer NOT NULL,
  kind         text NOT NULL,
  name         text NOT NULL,
  media_type   text NOT NULL,
  content      text NOT NULL,
  sha256       text NOT NULL,
  size_bytes   integer NOT NULL,
  source_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, attempt, name)
);
CREATE INDEX artifacts_execution_idx ON artifacts (execution_id);

CREATE TABLE model_calls (
  id               bigserial PRIMARY KEY,
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id     uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  task_id          uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  model            text NOT NULL,
  input_tokens     integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  cost_usd_micros  bigint NOT NULL DEFAULT 0,
  latency_ms       integer NOT NULL,
  outcome          text NOT NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL UNIQUE REFERENCES executions(id) ON DELETE CASCADE,
  body         text NOT NULL,           -- exact canonical bytes, so the stored sha256 can be re-verified
  sha256       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Security-relevant events (sign-in, sign-up, failures). Never stores secrets.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  ip           text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
