import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { ORIGIN, TestClient, makeApp, resetDb, setupDb } from "./helpers.js";

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await setupDb();
  app = await makeApp(db);
});
beforeEach(() => resetDb(db));
afterAll(async () => {
  await app.close();
  await db.end();
});

describe("authentication", () => {
  it("signs up with an HttpOnly, SameSite session cookie and an Argon2id hash", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", headers: { origin: ORIGIN }, payload: { email: "ada@example.com", password: "a long enough password" } });
    expect(res.statusCode).toBe(201);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const row = await db.query("SELECT password_hash FROM users WHERE email = 'ada@example.com'");
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const sessions = await db.query("SELECT token_hash FROM sessions");
    const token = cookie.split(";")[0]!.split("=")[1]!;
    expect(sessions.rows[0].token_hash.toString("hex")).not.toContain(Buffer.from(token).toString("hex"));
    expect(res.json().workspace.planId).toBe("free");
  });

  it("rejects weak passwords and duplicate emails", async () => {
    const c = new TestClient(app);
    expect((await c.request("POST", "/api/v1/auth/signup", { email: "a@example.com", password: "short" })).statusCode).toBe(400);
    await c.signup("a@example.com");
    const dup = await new TestClient(app).request("POST", "/api/v1/auth/signup", { email: "A@Example.com", password: "another long password" });
    expect(dup.statusCode).toBe(409);
  });

  it("logs in, resolves the session, and revokes it on logout", async () => {
    await new TestClient(app).signup("b@example.com", "the right password!");
    const c = new TestClient(app);
    expect((await c.request("POST", "/api/v1/auth/login", { email: "b@example.com", password: "the wrong password!" })).statusCode).toBe(401);
    const ok = await c.request("POST", "/api/v1/auth/login", { email: "b@example.com", password: "the right password!" });
    expect(ok.statusCode).toBe(200);
    c.csrf = ok.json().csrfToken;
    expect((await c.request("GET", "/api/v1/auth/session")).statusCode).toBe(200);
    const stolenCookie = c.cookie;
    expect((await c.request("POST", "/api/v1/auth/logout")).statusCode).toBe(204);
    const replay = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { cookie: stolenCookie } });
    expect(replay.statusCode).toBe(401);
  });

  it("gives the same answer for unknown emails and wrong passwords", async () => {
    await new TestClient(app).signup("c@example.com");
    const c = new TestClient(app);
    const unknown = await c.request("POST", "/api/v1/auth/login", { email: "nobody@example.com", password: "whatever password" });
    const wrong = await c.request("POST", "/api/v1/auth/login", { email: "c@example.com", password: "whatever password" });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it("requires the CSRF token and same origin for authenticated writes", async () => {
    const c = new TestClient(app);
    await c.signup("d@example.com");
    const goal = { goal: "Write a memo about our hiring plan" };
    expect((await c.request("POST", "/api/v1/executions", goal, { "x-csrf-token": "" })).statusCode).toBe(403);
    expect((await c.request("POST", "/api/v1/executions", goal, { "x-csrf-token": "forged" })).statusCode).toBe(403);
    expect((await c.request("POST", "/api/v1/executions", goal, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await c.request("POST", "/api/v1/executions", goal)).statusCode).toBe(201);
  });

  it("rejects unauthenticated access and cross-origin sign-up", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/executions" })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/signup", headers: { origin: "https://evil.example" }, payload: { email: "e@example.com", password: "a long enough password" } });
    expect(res.statusCode).toBe(403);
    const noOrigin = await app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: { email: "e@example.com", password: "a long enough password" } });
    expect(noOrigin.statusCode).toBe(403);
  });

  it("rate-limits repeated sign-in attempts", async () => {
    const c = new TestClient(app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await c.request("POST", "/api/v1/auth/login", { email: "x@example.com", password: "whatever password" })).statusCode);
    }
    // The limiter window is shared with earlier tests in this file, so assert the ceiling rather than the exact index.
    expect(codes.every((s) => s === 401 || s === 429)).toBe(true);
    expect(codes.filter((s) => s === 401).length).toBeLessThanOrEqual(10);
    expect(codes.at(-1)).toBe(429);
  });

  it("sends security headers including a strict CSP", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
