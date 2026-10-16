import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionInfo } from "@keplar/contracts";
import type { Db } from "../db/pool.js";
import { withTx } from "../db/pool.js";
import { AppError } from "../errors.js";
import { openAccount } from "../billing/credits.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password.js";

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  planId: string;
  role: string;
  csrfToken: string;
}

const sha256 = (token: string) => createHash("sha256").update(token).digest();

export function toSessionInfo(ctx: AuthContext): SessionInfo {
  return {
    user: { id: ctx.userId, email: ctx.email },
    workspace: { id: ctx.workspaceId, name: ctx.workspaceName, planId: ctx.planId, role: ctx.role },
    csrfToken: ctx.csrfToken,
  };
}

export async function audit(
  db: Pick<Db, "query">,
  action: string,
  opts: { userId?: string | null; workspaceId?: string | null; ip?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query("INSERT INTO audit_log (workspace_id, user_id, action, ip, metadata) VALUES ($1, $2, $3, $4, $5)", [
    opts.workspaceId ?? null,
    opts.userId ?? null,
    action,
    opts.ip ?? null,
    JSON.stringify(opts.metadata ?? {}),
  ]);
}

async function createSession(db: Pick<Db, "query">, userId: string, workspaceId: string, ttlHours: number) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, workspace_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [sha256(token), userId, workspaceId, csrfToken, expiresAt],
  );
  return { token, expiresAt };
}

export async function signup(
  db: Db,
  input: { email: string; password: string; workspaceName?: string | undefined },
  ttlHours: number,
  ip: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const passwordHash = await hashPassword(input.password);
  return withTx(db, async (tx) => {
    const exists = await tx.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [input.email]);
    if (exists.rowCount) {
      throw new AppError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    }
    const user = await tx.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id", [
      input.email.trim(),
      passwordHash,
    ]);
    const userId = user.rows[0]!.id;
    const name = input.workspaceName?.trim() || "Personal";
    const ws = await tx.query<{ id: string }>("INSERT INTO workspaces (name, plan_id) VALUES ($1, 'free') RETURNING id", [name]);
    const workspaceId = ws.rows[0]!.id;
    await tx.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, userId]);
    await openAccount(tx, workspaceId, "free");
    await audit(tx, "auth.signup", { userId, workspaceId, ip });
    return createSession(tx, userId, workspaceId, ttlHours);
  });
}

export async function login(
  db: Db,
  input: { email: string; password: string },
  ttlHours: number,
  ip: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const res = await db.query<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)",
    [input.email],
  );
  const user = res.rows[0];
  const ok = user
    ? await verifyPassword(user.password_hash, input.password)
    : await verifyPassword(await dummyPasswordHash(), input.password).then(() => false);
  if (!user || !ok) {
    await audit(db, "auth.login_failed", { userId: user?.id ?? null, ip });
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  }
  // First workspace by creation; multi-workspace switching is a later phase.
  const ws = await db.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
    [user.id],
  );
  const workspaceId = ws.rows[0]?.workspace_id;
  if (!workspaceId) throw new AppError(403, "no_workspace", "This account has no workspace.");
  await audit(db, "auth.login", { userId: user.id, workspaceId, ip });
  return createSession(db, user.id, workspaceId, ttlHours);
}

export async function resolveSession(db: Db, token: string): Promise<AuthContext | null> {
  if (!token || token.length > 128) return null;
  const res = await db.query(
    `SELECT s.id AS session_id, s.csrf_token, u.id AS user_id, u.email, w.id AS workspace_id, w.name AS workspace_name,
            w.plan_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    email: r.email,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    planId: r.plan_id,
    role: r.role,
    csrfToken: r.csrf_token,
  };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
}

export function csrfMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
