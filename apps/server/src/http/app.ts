import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AccountSummary, ApiErrorBody } from "@keplar/contracts";
import { ApproveExecutionRequest, CreateExecutionRequest, Credentials, SignupRequest } from "@keplar/contracts";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "../auth/service.js";
import { csrfMatches, login, resolveSession, revokeSession, signup, toSessionInfo } from "../auth/service.js";
import { getAccount } from "../billing/credits.js";
import { getPlan } from "../billing/plans.js";
import { CAPABILITIES } from "../capabilities/catalog.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import {
  approveExecution,
  cancelExecution,
  createExecution,
  getArtifact,
  getExecutionView,
  getReceipt,
  listExecutions,
} from "../orchestrator/executions.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export interface AppDeps {
  config: AppConfig;
  db: Db;
  modelProviderConfigured: boolean;
  logger?: boolean | object;
}

const UUID = z.uuid();
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookieName(config: AppConfig): string {
  // __Host- cookies are bound to this exact origin over HTTPS with no Domain attribute.
  return config.NODE_ENV === "production" ? "__Host-keplar_session" : "keplar_session";
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new AppError(400, "invalid_request", r.error.issues[0]?.message ?? "Invalid request", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  return req.auth;
}

function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: string }).id;
  if (!UUID.safeParse(id).success) throw new AppError(404, "not_found", "Not found");
  return id!;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const app = Fastify({
    logger: deps.logger ?? {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      redact: ["req.headers.cookie", "req.headers.authorization", "req.headers[\"x-csrf-token\"]", "res.headers[\"set-cookie\"]"],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    requestIdHeader: false,
  });
  const secureCookies = config.NODE_ENV === "production";
  const sessionCookie = cookieName(config);
  const appOrigin = new URL(config.APP_ORIGIN).origin;

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: secureCookies ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[sessionCookie];
    req.auth = token ? await resolveSession(db, token) : null;
    if (!req.url.startsWith("/api/") || !MUTATING.has(req.method)) return;
    // CSRF defence in depth: same-origin check on every mutating request, plus a per-session
    // token for authenticated ones. SameSite=Lax cookies already block most cross-site sends.
    const origin = req.headers.origin;
    if (origin && origin !== appOrigin) throw new AppError(403, "bad_origin", "Cross-origin request rejected");
    if (req.auth && !csrfMatches(req.auth.csrfToken, req.headers["x-csrf-token"] as string | undefined)) {
      throw new AppError(403, "csrf_failed", "Your session token is missing or stale. Reload and try again.");
    }
    if (!req.auth && !origin && req.headers["x-keplar-client"] !== "web") {
      throw new AppError(403, "bad_origin", "Missing origin");
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) {
      const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
      return reply.status(err.statusCode).send(body);
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ error: { code: "rate_limited", message: "Too many requests. Slow down and try again shortly." } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: "bad_request", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong on our side. The error has been logged." } });
  });

  const setSession = (reply: FastifyReply, token: string, expiresAt: Date) =>
    reply.setCookie(sessionCookie, token, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", expires: expiresAt });

  // ---- Health ---------------------------------------------------------------------------------
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  // ---- Auth -----------------------------------------------------------------------------------
  const authLimit = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } } };
  app.post("/api/v1/auth/signup", authLimit, async (req, reply) => {
    const body = parse(SignupRequest, req.body);
    const session = await signup(db, body, config.SESSION_TTL_HOURS, req.ip);
    setSession(reply, session.token, session.expiresAt);
    const auth = await resolveSession(db, session.token);
    return reply.status(201).send(toSessionInfo(auth!));
  });

  app.post("/api/v1/auth/login", authLimit, async (req, reply) => {
    const body = parse(Credentials, req.body);
    if (req.auth) await revokeSession(db, req.auth.sessionId);
    const session = await login(db, body, config.SESSION_TTL_HOURS, req.ip);
    setSession(reply, session.token, session.expiresAt);
    const auth = await resolveSession(db, session.token);
    return toSessionInfo(auth!);
  });

  app.post("/api/v1/auth/logout", async (req, reply) => {
    if (req.auth) await revokeSession(db, req.auth.sessionId);
    reply.clearCookie(sessionCookie, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/v1/auth/session", async (req) => toSessionInfo(requireAuth(req)));

  // ---- Account --------------------------------------------------------------------------------
  app.get("/api/v1/account", async (req): Promise<AccountSummary> => {
    const auth = requireAuth(req);
    const plan = getPlan(auth.planId);
    const account = await getAccount(db, auth.workspaceId);
    return {
      plan: { id: plan.id, name: plan.name, monthlyPriceUsd: plan.monthlyPriceUsd },
      credits: { availableMc: account.availableMc, reservedMc: account.reservedMc, grantedMc: account.grantedMc, periodStart: account.periodStart },
      requests: { used: account.requestsUsed, limit: plan.monthlyRequests },
      modelProvider: { configured: deps.modelProviderConfigured, provider: deps.modelProviderConfigured ? "anthropic" : null },
    };
  });

  app.get("/api/v1/capabilities", async (req) => {
    requireAuth(req);
    return Object.values(CAPABILITIES).map(({ id, label, agent, permissions, baseCostMc }) => ({ id, label, agent, permissions, baseCostMc }));
  });

  // ---- Executions -----------------------------------------------------------------------------
  const planLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  app.post("/api/v1/executions", planLimit, async (req, reply) => {
    const auth = requireAuth(req);
    const { goal } = parse(CreateExecutionRequest, req.body);
    const id = await createExecution(db, auth, goal, { modelProviderConfigured: deps.modelProviderConfigured });
    return reply.status(201).send(await getExecutionView(db, auth, id));
  });

  app.get("/api/v1/executions", async (req) => listExecutions(db, requireAuth(req)));
  app.get("/api/v1/executions/:id", async (req) => getExecutionView(db, requireAuth(req), idParam(req)));

  app.post("/api/v1/executions/:id/approve", async (req) => {
    const auth = requireAuth(req);
    const id = idParam(req);
    const { planHash } = parse(ApproveExecutionRequest, req.body);
    await approveExecution(db, auth, id, planHash);
    return getExecutionView(db, auth, id);
  });

  app.post("/api/v1/executions/:id/cancel", async (req) => {
    const auth = requireAuth(req);
    const id = idParam(req);
    await cancelExecution(db, auth, id);
    return getExecutionView(db, auth, id);
  });

  app.get("/api/v1/executions/:id/receipt", async (req, reply) => {
    const { raw, sha256 } = await getReceipt(db, requireAuth(req), idParam(req));
    // Serve the exact stored bytes so the digest header can be checked by the client.
    return reply.header("content-type", "application/json; charset=utf-8").header("x-receipt-sha256", sha256).send(raw);
  });

  app.get("/api/v1/artifacts/:id", async (req, reply) => {
    const artifact = await getArtifact(db, requireAuth(req), idParam(req));
    // Content is returned as JSON data, never as HTML, so fetched pages cannot execute in our origin.
    return reply.header("cache-control", "private, no-store").send(artifact);
  });

  app.all("/api/*", async () => {
    throw new AppError(404, "not_found", "No such endpoint");
  });

  // ---- Web client (production) ----------------------------------------------------------------
  if (config.WEB_DIST_DIR && existsSync(config.WEB_DIST_DIR)) {
    const root = path.resolve(config.WEB_DIST_DIR);
    await app.register(fastifyStatic, { root, wildcard: false, index: false });
    app.get("/*", (_req, reply) => reply.sendFile("index.html", root));
  }

  return app;
}
