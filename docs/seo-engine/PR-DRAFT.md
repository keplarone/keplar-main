# Pull request draft: `claude/seo-intent-engine` → `keplar-live@main`

Not opened by the session (the owner opens pull requests). Title: **Search intent engine: clusters, free tools, reports, public-answer gates, Search Console, SEO gate in CI**. Base `main`, head `claude/seo-intent-engine` (`90e4df4`). Body below follows `.github/pull_request_template.md`.

---

## What changed

The search-intent engine for keplar.one, built on the existing SEO infrastructure (nothing rebuilt): 11 named search-intent clusters with hubs and cluster links, five new hub pages, a free-tool network (`/tools`, ten tools, seven on free models through the existing embed ask path with 4 runs a minute and 25 a day per visitor, three fully local), a research-report family (`/reports`, first report from the October Core evals, sections and data files enforced by test), a sitemap index and registry, quality gates for programmatic pages (title and description bounds, shingle near-duplicate and metadata-collision checks), content moderation and a kill switch for public answers, server-rendered page excerpts on template detail pages, honest and tracked CTAs, telemetry on the chat home, first-touch attribution carried into checkout and reported on `/admin/seo`, a Search Console module and admin section (reads nothing until the owner adds credentials), and a post-build SEO crawl gate in `npm run verify` and CI. Facts stated one way each (web search, Business pricing, API availability, agents), blog search titles, 16 shortened descriptions, pricing metadata from the plan table, the duplicate guide redirected to its blog post, "Free tools" translated in the 24 stable locales.

Audit: `docs/seo/AUDIT-2026-10-19.md` (13 dimensions, 153 findings, 32 verifier verdicts, synthesis, completeness review, and the status of every High finding). Progress: `docs/seo/PROGRESS.md`. No traffic, ranking or index figures are claimed anywhere.

## Security review

- [x] **No new secret** in code, tests, fixtures or workflow files (`node scripts/secret-scan.mjs` is clean; the Search Console test generates a throwaway RSA key at run time).
- [x] **Authorization:** `/api/tools/run` is public by design (anonymous Free workspace through `currentWorkspace(req, { allowAnonymous: true })`, forced to free models, moderation and demo limits as the embed ask path, plus 4/min and 25/day per IP); `/api/share` PATCH keeps its session and ownership checks and gains two refusal codes (`unsafe`, `paused`). No other route changed its authorization.
- [x] **Input:** tool inputs are validated and bounded per field in `src/lib/free-tools/prompts.ts` (material caps sized so the built prompt fits the Free lane); checkout `attribution` is allow-listed by `sanitizeAttribution` (landing path from the sitemap set, source class from `SEO_SOURCES`, bounded campaign tags; never the browser id or referrer URL). The only new outbound fetches are to `oauth2.googleapis.com` and `www.googleapis.com` with fixed hosts in `src/lib/seo/gsc.ts`.
- [x] **Data:** `whop_payments` rows gain an optional `attribution` field (landing path, source class, campaign tags); it is not personal data and is recorded only when the visitor allowed Analytics. `docs/privacy-inventory.md` unchanged for that reason; say if it should list the field anyway.
- [x] **Dependencies:** none added; the lockfile is unchanged.
- [x] **Agents / AI:** the free tools call the model pipeline with the visitor's anonymous workspace and the Free lane's budget; no agent or action on the world was added.
- [x] **Checklist:** `security/checklist.json` unchanged (no control added or removed).

## How it was verified

Full gate on the branch head: `npx tsc --noEmit`, `npx eslint . --quiet`, `npm test` (3,149 passing, 0 failing, 2 skipped of 3,151), `next build` with the CI environment values, then `node scripts/seo-gate.mjs --start` crawling the built site (213 of 213 English sitemap pages, no issues). Tool pages and the run endpoint were exercised against `next start` locally (free-model runs answer 502 "not connected" without provider keys, as designed). Not verified: a production deployment (none made; this ships through CI and the owner's merge), Search Console reads (no credentials), moderation with the hosted classifier (rules engine only in tests).

Owner decisions this PR leaves open, listed in the audit's Part A: CI-gated deploys (a Vercel or repository setting), font subsets and CSS split, Whop pixel consent, beta-locale indexing, and whether agents exist on Keplar One Plus/Pro today.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01AcDyxethSahbR5fczm1o2Z
