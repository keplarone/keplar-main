# Keplar One

Tell Keplar what you want accomplished. It builds a plan you can read, runs it only after you approve that exact plan, checks the results independently, and gives you an outcome receipt that says what was done, what was verified, what it cost and what is left for you.

This repository contains the first vertical slice of that flow. What is and is not built is tracked honestly in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Run it locally

Requirements: Node 22+, Docker (or a local PostgreSQL 16).

```bash
docker compose up -d          # PostgreSQL on :5432
cp .env.example .env
npm install
npm run dev                   # migrates, then API :3000, worker, web :5173
```

Open http://localhost:5173. Without `ANTHROPIC_API_KEY`, documents are composed from templates and labelled that way.

## Checks

```bash
npm run typecheck
npm test                      # unit + integration against real Postgres
npm run build && npm run test:e2e
npm run audit:deps && npm run scan:secrets
```

## Layout

| Path | What |
|---|---|
| `apps/server` | Fastify API, background worker, planner, capabilities, verifier, billing |
| `apps/web` | React app |
| `packages/contracts` | Shared types and Zod schemas |
| `e2e` | Playwright + axe tests |
| `docs` | Product, architecture, security, threat model, pricing, operations, decisions |
