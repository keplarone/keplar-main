import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consumeRequest, reserve, settle } from "../src/billing/credits.js";
import type { Db } from "../src/db/pool.js";
import { withTx } from "../src/db/pool.js";
import { createModelGateway } from "../src/models/gateway.js";
import { AnthropicProvider } from "../src/models/anthropic.js";
import type { GenerateRequest, GenerateResult, ModelProvider } from "../src/models/types.js";
import { ModelOutputError } from "../src/models/types.js";
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

async function user(email: string) {
  const c = new TestClient(app);
  const s = await c.signup(email);
  return { c, workspaceId: s.workspace.id as string, userId: s.user.id as string };
}

describe("tenant isolation", () => {
  it("never exposes one workspace's executions, receipts or artifacts to another", async () => {
    const a = await user("a@example.com");
    const b = await user("b@example.com");
    const created = (await a.c.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
    await a.c.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash });
    await makeWorker(db).drain();
    const done = (await a.c.request("GET", `/api/v1/executions/${created.id}`)).json();
    const artifactId = done.artifacts[0].id;

    // B sees 404 (not 403) so resource existence is not revealed.
    expect((await b.c.request("GET", `/api/v1/executions/${created.id}`)).statusCode).toBe(404);
    expect((await b.c.request("GET", `/api/v1/executions/${created.id}/receipt`)).statusCode).toBe(404);
    expect((await b.c.request("GET", `/api/v1/artifacts/${artifactId}`)).statusCode).toBe(404);
    expect((await b.c.request("POST", `/api/v1/executions/${created.id}/cancel`)).statusCode).toBe(404);
    expect((await b.c.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash })).statusCode).toBe(404);
    expect((await b.c.request("GET", "/api/v1/executions")).json()).toEqual([]);
    expect((await a.c.request("GET", "/api/v1/executions")).json()).toHaveLength(1);

    // B's account is untouched by A's spend.
    expect((await b.c.request("GET", "/api/v1/account")).json().credits.availableMc).toBe(5000);
    expect((await a.c.request("GET", "/api/v1/account")).json().credits.availableMc).toBe(4700);
  });

  it("rejects malformed ids without touching the database", async () => {
    const a = await user("a@example.com");
    expect((await a.c.request("GET", "/api/v1/executions/not-a-uuid")).statusCode).toBe(404);
    expect((await a.c.request("GET", "/api/v1/executions/1' OR '1'='1")).statusCode).toBe(404);
  });

  it("cannot approve another workspace's plan even with its hash", async () => {
    const a = await user("a@example.com");
    const b = await user("b@example.com");
    const created = (await a.c.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
    await b.c.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash });
    expect((await a.c.request("GET", `/api/v1/executions/${created.id}`)).json().status).toBe("awaiting_approval");
  });
});

describe("credit ledger", () => {
  it("cannot spend the same credits twice under concurrent reservations", async () => {
    const { workspaceId, userId } = await user("a@example.com");
    // Twenty concurrent 1-credit reservations against a 5-credit balance.
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO executions (workspace_id, created_by, goal, intent, status, planner, plan_hash, estimated_mc)
         VALUES ($1, $2, 'g', '{}', 'awaiting_approval', 'p', 'h', 1000) RETURNING id`,
        [workspaceId, userId],
      );
      ids.push(r.rows[0]!.id);
    }
    const results = await Promise.allSettled(ids.map((id) => withTx(db, (tx) => reserve(tx, workspaceId, id, 1000))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const acct = await db.query("SELECT available_mc, reserved_mc FROM credit_accounts WHERE workspace_id = $1", [workspaceId]);
    expect(acct.rows[0]).toMatchObject({ available_mc: 0, reserved_mc: 5000 });
    const ledger = await db.query("SELECT count(*)::int AS n FROM credit_ledger WHERE workspace_id = $1 AND kind = 'reserve'", [workspaceId]);
    expect(ledger.rows[0].n).toBe(5);
  });

  it("settles idempotently and never charges more than was reserved", async () => {
    const { workspaceId, userId } = await user("a@example.com");
    const r = await db.query<{ id: string }>(
      `INSERT INTO executions (workspace_id, created_by, goal, intent, status, planner, plan_hash, estimated_mc)
       VALUES ($1, $2, 'g', '{}', 'running', 'p', 'h', 1000) RETURNING id`,
      [workspaceId, userId],
    );
    const id = r.rows[0]!.id;
    await withTx(db, (tx) => reserve(tx, workspaceId, id, 1000));
    await withTx(db, (tx) => reserve(tx, workspaceId, id, 1000)); // duplicate request: no double reservation
    const first = await withTx(db, (tx) => settle(tx, workspaceId, id, 1000, 5000));
    const again = await withTx(db, (tx) => settle(tx, workspaceId, id, 1000, 5000));
    expect(first).toEqual({ chargedMc: 1000, releasedMc: 0 });
    expect(again).toEqual(first);
    const acct = await db.query("SELECT available_mc, reserved_mc FROM credit_accounts WHERE workspace_id = $1", [workspaceId]);
    expect(acct.rows[0]).toMatchObject({ available_mc: 4000, reserved_mc: 0 });
    // The ledger replays to the stored balance.
    const rows = (await db.query("SELECT kind, amount_mc FROM credit_ledger WHERE workspace_id = $1 ORDER BY id", [workspaceId])).rows;
    const available = rows.reduce((s, x) => s + (x.kind === "grant" ? x.amount_mc : x.kind === "reserve" ? -x.amount_mc : x.kind === "release" ? x.amount_mc : 0), 0);
    expect(available).toBe(4000);
  });

  it("enforces the monthly request quota server-side", async () => {
    const { workspaceId } = await user("a@example.com");
    for (let i = 0; i < 3; i++) await withTx(db, (tx) => consumeRequest(tx, workspaceId, 3));
    await expect(withTx(db, (tx) => consumeRequest(tx, workspaceId, 3))).rejects.toMatchObject({ statusCode: 429, code: "request_quota_exhausted" });
  });

  it("returns 429 through the API when the plan's requests are used up", async () => {
    const a = await user("a@example.com");
    await db.query("UPDATE credit_accounts SET requests_used = 30 WHERE workspace_id = $1", [a.workspaceId]);
    const res = await a.c.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("request_quota_exhausted");
  });
});

class FakeProvider implements ModelProvider {
  readonly name = "anthropic" as const;
  calls: string[] = [];
  constructor(private readonly behave: (model: string) => GenerateResult | Error) {}
  async generate(model: string, _req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(model);
    const out = this.behave(model);
    if (out instanceof Error) throw out;
    return out;
  }
}

describe("model gateway and adapter", () => {
  async function scope() {
    const a = await user("a@example.com");
    const created = (await a.c.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
    return { workspaceId: a.workspaceId, executionId: created.id as string, taskId: created.tasks[0].id as string };
  }

  it("records real token usage and cost for each call", async () => {
    const s = await scope();
    const p = new FakeProvider((model) => ({ text: "ok", model, inputTokens: 1000, outputTokens: 500, stopReason: "end_turn" }));
    const gw = createModelGateway(db, [p], { ...s, allowedTiers: ["light"], signal: new AbortController().signal });
    const out = await gw.generate({ preferredTier: "standard", system: "s", prompt: "p", maxTokens: 100 });
    expect(out.model).toBe("claude-haiku-5-5");
    expect(out.costUsd).toBeCloseTo((1000 * 0.1 + 500 * 0.5) / 1e6, 10);
    const rows = (await db.query("SELECT model, input_tokens, output_tokens, cost_usd_micros, outcome FROM model_calls")).rows;
    expect(rows).toEqual([{ model: "claude-haiku-5-5", input_tokens: 1000, output_tokens: 500, cost_usd_micros: 350, outcome: "ok" }]);
  });

  it("falls back to a cheaper model on a retryable provider failure, but not on a refusal", async () => {
    const s = await scope();
    const flaky = new FakeProvider((model) =>
      model === "claude-sonnet-5-5" ? new ModelOutputError("overloaded", true) : { text: "ok", model, inputTokens: 1, outputTokens: 1, stopReason: "end_turn" },
    );
    const gw = createModelGateway(db, [flaky], { ...s, allowedTiers: ["light", "standard"], signal: new AbortController().signal });
    expect((await gw.generate({ preferredTier: "standard", system: "s", prompt: "p", maxTokens: 10 })).model).toBe("claude-haiku-5-5");
    expect(flaky.calls).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);

    const refusing = new FakeProvider(() => new ModelOutputError("declined", false));
    const gw2 = createModelGateway(db, [refusing], { ...s, allowedTiers: ["light", "standard"], signal: new AbortController().signal });
    await expect(gw2.generate({ preferredTier: "standard", system: "s", prompt: "p", maxTokens: 10 })).rejects.toThrow("declined");
    expect(refusing.calls).toHaveLength(1);
  });

  it("treats refusals and truncation from the Anthropic API as failures, not success", async () => {
    const fakeClient = (stop: string, text = "partial") =>
      ({ messages: { create: async () => ({ model: "claude-haiku-5-5", stop_reason: stop, content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 5 } }) } }) as never;
    await expect(new AnthropicProvider("k", fakeClient("refusal")).generate("m", { system: "s", prompt: "p", maxTokens: 10 })).rejects.toMatchObject({ retryable: false });
    await expect(new AnthropicProvider("k", fakeClient("max_tokens")).generate("m", { system: "s", prompt: "p", maxTokens: 10 })).rejects.toMatchObject({ retryable: true });
    await expect(new AnthropicProvider("k", fakeClient("end_turn", "  ")).generate("m", { system: "s", prompt: "p", maxTokens: 10 })).rejects.toThrow(/no text/);
    const ok = await new AnthropicProvider("k", fakeClient("end_turn", "# Doc")).generate("m", { system: "s", prompt: "p", maxTokens: 10 });
    expect(ok).toMatchObject({ text: "# Doc", inputTokens: 5, outputTokens: 5 });
  });

  it("runs a model-composed task end to end and charges for actual provider spend", async () => {
    const appWithModel = await makeApp(db, { modelProviderConfigured: true, authRateLimit: 1000 });
    try {
      const c = new TestClient(appWithModel);
      await c.signup("m@example.com");
      const created = (await c.request("POST", "/api/v1/executions", { goal: "Write a memo about our hiring plan for next quarter" })).json();
      expect(created.tasks[0].permissions).toContain("model.generate");
      expect(created.estimatedMc).toBe(1000);
      await c.request("POST", `/api/v1/executions/${created.id}/approve`, { planHash: created.planHash });
      const doc = ["Objective", "Approach", "Deliverables", "Risks", "Next steps"].map((h) => `## ${h}\n\nConcrete content for ${h.toLowerCase()}, written with enough specific detail that a reader can act on it without asking again.`).join("\n\n");
      const provider = new FakeProvider((model) => ({ text: `# Memo\n\n${doc}`, model, inputTokens: 20_000, outputTokens: 4_000, stopReason: "end_turn" }));
      await makeWorker(db, { providers: [provider] }).drain();
      const done = (await c.request("GET", `/api/v1/executions/${created.id}`)).json();
      expect(done.status).toBe("completed");
      const receipt = (await c.request("GET", `/api/v1/executions/${created.id}/receipt`)).json();
      expect(receipt.usage.modelCalls).toHaveLength(1);
      expect(receipt.usage.providerCostUsd).toBeCloseTo((20_000 * 0.1 + 4_000 * 0.5) / 1e6, 10);
      // 300 base + ceil(0.004 / 0.15 * 1000) = 300 + 27
      expect(receipt.usage.chargedMc).toBe(327);
      expect(receipt.usage.releasedMc).toBe(673);
    } finally {
      await appWithModel.close();
    }
  });
});
