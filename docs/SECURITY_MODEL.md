# Security model

Reference: OWASP ASVS 4.0.3 (L2 targets). Nothing here claims the system is secure; it lists controls and how each is verified.

| Area | Control | Where | Verified by |
|---|---|---|---|
| Passwords | Argon2id (m=19 MiB, t=2, p=1), 12–256 chars, dummy hash for unknown users | `auth/password.ts` | `auth.test.ts` (hash prefix, identical error for unknown/wrong) |
| Sessions | 256-bit random opaque token; only its SHA-256 stored; HttpOnly, SameSite=Lax, Secure + `__Host-` prefix in production; revocable; absolute expiry | `auth/service.ts`, `http/app.ts` | `auth.test.ts` (cookie flags, revoked token replay → 401) |
| CSRF | Origin must equal `APP_ORIGIN` on writes; per-session token in `x-csrf-token` (constant-time compare); unauthenticated writes need Origin or `x-keplar-client` | `http/app.ts` | `auth.test.ts` (missing/forged token, foreign origin → 403) |
| Access control | Every query filters on the session's `workspace_id`; foreign resources return 404; UUIDs validated before querying | `orchestrator/executions.ts` | `isolation-and-billing.test.ts` |
| Input validation | Zod schemas on every body; 64 KiB body limit; goal 8–4000 chars | `packages/contracts`, `http/app.ts` | `execution.test.ts` |
| SQL injection | Parameterized queries only; the one dynamic identifier list is an allow-list | `state-machine.ts` | review + malformed id test |
| XSS | React escaping; artifacts rendered by a React-element Markdown renderer (no `innerHTML`), links limited to http(s) with `rel=noopener noreferrer nofollow`; artifacts served as JSON, never HTML | `web/src/components/Markdown.tsx` | e2e asserts no CSP violations |
| CSP & headers | `default-src 'self'`, no inline script/style, `frame-ancestors 'none'`, `object-src 'none'`, HSTS in production, nosniff | `http/app.ts` | `auth.test.ts`, e2e console check |
| SSRF | http/https only, ports 80/443, no credentials in URL, every DNS answer checked at connect time (no rebinding window), literal IPs checked, redirects re-validated, 2 MiB / 15 s caps | `capabilities/safe-fetch.ts` | `safe-fetch.test.ts`, `execution.test.ts` (loopback blocked through the real worker) |
| Prompt injection | Plan is fixed and hashed before any external content is read; fetched text is delimited as untrusted data in model prompts; capabilities cannot add tasks or take actions | `capabilities/compose.ts`, `planner.ts` | `execution.test.ts` (injected page cannot change the plan) |
| Unauthorized agent actions | Approval required for every execution, bound to the plan hash; capability gaps blocked, never simulated | `executions.ts`, `intent.ts` | `execution.test.ts` |
| Resource abuse | Global rate limit 300/min/IP, auth 10/min/IP, planning 20/min/IP; monthly request quota; per-execution credit ceiling; task timeouts | `http/app.ts`, `billing/` | `auth.test.ts`, `isolation-and-billing.test.ts` |
| Double spend | Row-locked balance + CHECK constraints + unique idempotency keys | `billing/credits.ts` | 20 concurrent reservations → exactly 5 succeed |
| Secrets | Read from environment only, validated at boot; never logged (pino redaction of cookie, CSRF, set-cookie) | `config.ts`, `http/app.ts` | `npm run scan:secrets`, gitleaks in CI |
| Dependencies | Pinned versions, lockfile, `npm audit --audit-level=high` as a CI gate | CI | `npm audit`: 0 vulnerabilities at commit time |
| Crypto | Only Node's `crypto` (SHA-256, CSPRNG) and Argon2id via `@node-rs/argon2`. No custom cryptography. | — | review |

## Known gaps (not yet implemented)

- Encryption at rest for artifacts and integration tokens (plan: cloud KMS envelope encryption, AES-256-GCM).
- Postgres row-level security as a second tenant-isolation layer (currently application-enforced only).
- Rate limits are per-process in-memory; multi-instance deployments need a shared store (Redis).
- No MFA, email verification, password reset or account lockout beyond rate limiting.
- No DAST run yet; CodeQL and gitleaks are configured in CI but have not run on GitHub at the time of writing.
- Model-generated documents are verified structurally, not for factual accuracy.
