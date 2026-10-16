import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { TestClient, makeApp, makeWorker, resetDb, setupDb } from "./helpers.js";

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await setupDb();
  app = await makeApp(db, { authRateLimit: 1000 });
});
beforeEach(() => resetDb(db));
afterAll(async () => {
  await app.close();
  await db.end();
});

describe("usage summary", () => {
  it("reports the period's charges, executions, capabilities, model spend and ledger from real records", async () => {
    const a = new TestClient(app);
    const session = await a.signup("a@example.com");
    const created = (await a.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
    await a.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash });
    await makeWorker(db).drain();

    // One model call recorded against that execution, as the gateway would write it.
    const task = await db.query("SELECT id FROM tasks WHERE execution_id = $1 LIMIT 1", [created.id]);
    await db.query(
      `INSERT INTO model_calls (workspace_id, execution_id, task_id, provider, model, input_tokens, output_tokens, cost_usd_micros, latency_ms, outcome)
       VALUES ($1, $2, $3, 'anthropic', 'claude-haiku-5-5', 1200, 300, 4500, 800, 'ok'),
              ($1, $2, $3, 'anthropic', 'claude-haiku-5-5', 0, 0, 0, 120, 'error')`,
      [session.workspace.id, created.id, task.rows[0]!.id],
    );

    const res = await a.request("GET", "/api/v1/usage");
    expect(res.statusCode).toBe(200);
    const u = res.json();
    expect(u.credits).toEqual({ grantedMc: 5000, availableMc: 4700, reservedMc: 0, chargedMc: 300 });
    expect(u.requests).toEqual({ used: 1, limit: 30 });
    expect(u.executions).toEqual({ total: 1, byStatus: { completed: 1 } });
    expect(u.capabilities).toEqual([{ capability: "doc.compose", tasks: 1, chargedMc: 300 }]);
    expect(u.models).toEqual([
      { provider: "anthropic", model: "claude-haiku-5-5", calls: 2, failures: 1, inputTokens: 1200, outputTokens: 300, costUsdMicros: 4500 },
    ]);
    expect(u.providerCostUsdMicros).toBe(4500);
    expect(u.ledger.map((l: { kind: string }) => l.kind)).toEqual(["release", "charge", "reserve", "grant"]);
    expect(u.ledger[0].goal).toBe("Write a memo about our hiring plan for next quarter");
    expect(u.period.start < u.period.end).toBe(true);
  });

  it("is scoped to the caller's workspace and requires sign-in", async () => {
    const a = new TestClient(app);
    await a.signup("a@example.com");
    const created = (await a.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
    await a.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash });
    await makeWorker(db).drain();

    const b = new TestClient(app);
    await b.signup("b@example.com");
    const u = (await b.request("GET", "/api/v1/usage")).json();
    expect(u.credits.chargedMc).toBe(0);
    expect(u.executions.total).toBe(0);
    expect(u.models).toEqual([]);
    expect(u.ledger.map((l: { kind: string }) => l.kind)).toEqual(["grant"]);

    expect((await new TestClient(app).request("GET", "/api/v1/usage")).statusCode).toBe(401);
  });
});
