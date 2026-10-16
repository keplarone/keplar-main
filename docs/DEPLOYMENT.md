# Deployment

**Status: not deployed.** No environment exists yet; nothing in this document has been executed against real infrastructure.

## Shape

- **API**: `node apps/server/dist/api-main.js` — stateless, horizontally scalable, serves the built SPA when `WEB_DIST_DIR` is set.
- **Worker**: `node apps/server/dist/worker-main.js` — stateless, scale on queue depth; graceful drain on SIGTERM.
- **Migrations**: `node apps/server/dist/migrate-main.js` as a release step (advisory-locked, forward-only, transactional).
- **PostgreSQL 16**: managed instance with PITR backups.

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | TLS (`sslmode=require`) in production |
| `APP_ORIGIN` | yes | Must be `https://` in production (enforced at boot) |
| `NODE_ENV` | yes | `production` enables Secure/`__Host-` cookies and HSTS |
| `TRUST_PROXY` | behind a load balancer | `true` only behind a trusted proxy |
| `ANTHROPIC_API_KEY` | optional | From a secret manager, never in the repo |
| `WEB_DIST_DIR` | API | e.g. `apps/web/dist` |
| `WORKER_CONCURRENCY`, `WORKER_LEASE_MS`, `WORKER_POLL_MS` | optional | Defaults 4 / 30000 / 500 |

## Release gates (CI must be green)

Typecheck · unit + integration tests · build · `npm audit --audit-level=high` · secret scans · Playwright + axe. A failing gate blocks release.

## Rollback

Application: redeploy the previous build. Database: migrations are forward-only and must stay backward compatible with the previous release (expand → migrate → contract).

## Open decisions (need the owner)

Hosting provider, region, domain, managed Postgres vendor, secret manager. These involve paid commitments, so they wait for approval.
