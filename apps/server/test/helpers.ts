import type { FastifyInstance } from "fastify";
import { DEFAULT_HANDLERS } from "../src/capabilities/index.js";
import { DEFAULT_FETCH_OPTIONS } from "../src/capabilities/safe-fetch.js";
import type { CapabilityHandlers } from "../src/capabilities/types.js";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import type { Db } from "../src/db/pool.js";
import { createPool } from "../src/db/pool.js";
import { Worker } from "../src/engine/worker.js";
import { buildApp } from "../src/http/app.js";
import type { ModelProvider } from "../src/models/types.js";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://keplar:keplar@localhost:5432/keplar_test";
export const ORIGIN = "http://localhost:5173";

export async function setupDb(): Promise<Db> {
  const db = createPool(TEST_DATABASE_URL, 20);
  await migrate(db);
  await resetDb(db);
  return db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.query(
    `TRUNCATE users, workspaces, memberships, sessions, credit_accounts, credit_ledger, executions, tasks, execution_events,
              jobs, artifacts, model_calls, receipts, audit_log RESTART IDENTITY CASCADE`,
  );
}

export async function makeApp(db: Db, opts: { modelProviderConfigured?: boolean; authRateLimit?: number } = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    APP_ORIGIN: ORIGIN,
    AUTH_RATE_LIMIT_PER_MINUTE: String(opts.authRateLimit ?? 10),
  } as NodeJS.ProcessEnv);
  return buildApp({ config, db, modelProviderConfigured: opts.modelProviderConfigured ?? false, logger: false });
}

export function makeWorker(
  db: Db,
  opts: { handlers?: Partial<CapabilityHandlers>; providers?: ModelProvider[]; fetchOptions?: Partial<typeof DEFAULT_FETCH_OPTIONS>; workerId?: string; leaseMs?: number } = {},
): Worker {
  return new Worker({
    db,
    concurrency: 1,
    pollMs: 20,
    leaseMs: opts.leaseMs ?? 5_000,
    handlers: { ...DEFAULT_HANDLERS, ...opts.handlers },
    providers: opts.providers ?? [],
    fetchOptions: { ...DEFAULT_FETCH_OPTIONS, ...opts.fetchOptions },
    log: () => undefined,
    ...(opts.workerId ? { workerId: opts.workerId } : {}),
  });
}

/** A signed-in browser-like client against the in-process app. */
export class TestClient {
  cookie = "";
  csrf = "";
  constructor(readonly app: FastifyInstance) {}

  async request(method: "GET" | "POST", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        origin: ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const setCookie = res.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(";")[0]!;
    return res;
  }

  async signup(email: string, password = "correct horse battery staple") {
    const res = await this.request("POST", "/api/v1/auth/signup", { email, password });
    if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
    this.csrf = res.json().csrfToken;
    return res.json();
  }
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, everyMs = 25): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
