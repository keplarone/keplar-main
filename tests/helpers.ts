import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { db } from "@/lib/db";

// Tests run against a real Postgres (TEST_DATABASE_URL) with OpenRouter faked
// in memory.

export const ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://keplar:keplar@localhost:5432/keplar_test",
  KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  OPENROUTER_PROVISIONING_KEY: "sk-or-prov-test",
  WHOP_API_KEY: "whop-test",
  WHOP_COMPANY_ID: "biz_test",
  WHOP_WEBHOOK_SECRET: "ws_" + Buffer.from("test-webhook-secret-test-webhook").toString("base64"),
  APP_URL: "https://app.example.com",
  CRON_SECRET: "cron-secret",
  WHOP_PLAN_IDS_LITE: "plan_lite_m,plan_lite_y",
  WHOP_PLAN_IDS_PLUS: "plan_plus",
  WHOP_PLAN_IDS_PRO: "plan_pro",
  WHOP_CREDIT_PACKS: JSON.stringify({ plan_pack5: 5, plan_pack10: 10 }),
};

export async function resetDb() {
  Object.assign(process.env, ENV);
  const sql = db();
  await sql.unsafe("drop table if exists credit_ledger, customers cascade");
  await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
}

export interface FakeKey {
  hash: string;
  key: string;
  name: string;
  limit: number;
  usage: number;
}

export function fakeOpenRouter() {
  const keys = new Map<string, FakeKey>();
  let n = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const view = (k: FakeKey) => ({
      hash: k.hash, name: k.name, disabled: false, limit: k.limit, usage: k.usage,
      limit_remaining: Math.max(0, k.limit - k.usage),
    });
    if (path === "/keys" && init.method === "POST") {
      const k = { hash: `h${++n}`, key: `sk-or-v1-${n}`, name: body.name, limit: body.limit, usage: 0 };
      keys.set(k.hash, k);
      return Response.json({ key: k.key, data: view(k) }, { status: 201 });
    }
    const k = keys.get(decodeURIComponent(path.replace("/keys/", "")));
    if (!k) return new Response("not found", { status: 404 });
    if (init.method === "PATCH") k.limit = body.limit;
    return Response.json({ data: view(k) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { keys, fetchMock, only: () => [...keys.values()][0] };
}

export function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay_1",
    plan_id: "plan_lite_m",
    line_items: [],
    member_id: "mber_1",
    user: { id: "user_1", username: "u", name: null },
    total: { amount: "8.00", currency: "usd", decimals: 2, display_decimals: 2 },
    metadata: null,
    status: "paid",
    ...overrides,
  } as never;
}

export async function closeDb() {
  await db().end();
  delete (globalThis as { sql?: unknown }).sql;
}
