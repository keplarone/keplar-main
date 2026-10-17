# Search Intent Domination Engine — Checkpoint

**Saved:** 2026-10-17 (session `session_01AcDyxethSahbR5fczm1o2Z`)
**Status:** Phase 1 (audit) partially complete. **No product code has been changed in any repository.** Resume from "Continuation instructions" below.

Legend for every claim in this file: **Observed** = read from the repository or a tool result in this session. **Preliminary** = reasoned from what was read, not yet verified by a second pass. Nothing here is a traffic, ranking or indexing claim.

---

## 1. The single most important finding: this repository is not the product

| Repository | What it holds (observed) |
|---|---|
| `keplarone/keplar-main` (this repo, designated branch `claude/inspiring-hypatia-meru1j`) | `main` is an **empty initial commit**. Two feature branches hold early experiments: `claude/vertical-slice-goal-to-receipt` (Fastify + Vite monorepo, open PR [keplarone/keplar-main#1](https://github.com/keplarone/keplar-main/pull/1)) and `claude/compassionate-dijkstra-a7318u` (Next.js Whop→OpenRouter credits, 28 files). Neither has chat history, Study, slides, image, video or presentation features. |
| `keplarone/keplar-live` | **The production site.** Vercel project `keplar` (`prj_cM3koE7T8rr1JnVSgW6MSVV8PX94`, team `team_nS1LQFUJNE9aln2WTbUjuJ5v`) deploys `keplar-live@main` to `keplar.one`, `www.keplar.one` (308 → apex), `docs.keplar.one`, `space.keplar.one`, `business.keplar.one`. Live production commit at checkpoint time: `757eac7` ("Merge pull request #17 … security checklist"). |

**Decision taken this session:** the master prompt requires preserving auth, billing, chat history, Study, image, video and presentations. Those exist only in `keplar-live`, so the engine must be built there. `keplar-live` was attached to the session with push access (`add_repo`) and cloned to `/home/user/keplar-live`. The next session must re-attach it (step 2 below).

**Open decision for the owner (not blocking):** which branch on `keplar-live` the work should land on. Recommendation: `claude/seo-intent-engine` from `origin/main`, merged by pull request so the CI gate (`.github/workflows/ci.yml`) runs before Vercel deploys `main`. Nothing has been pushed to `keplar-live`.

---

## 2. keplar-live: stack facts (observed)

- Next.js `~16.3.8` (App Router), React 19, TypeScript 6, Node 24 on Vercel (`nodeVersion: 24.x`), CI uses Node 22.
- 3,366 tracked files; `src/` 2,283; `tests/` 409 unit test files (`node --test` via tsx); `e2e/` 52 Playwright specs; `docs/` 218 files; `content/` 111 Markdown files.
- Auth: better-auth. Billing: Whop (consumer plans) + Stripe Connect (Business sellers) + Apple IAP. Store: Neon Postgres (`DATABASE_URL`) or file store; Inngest for durable jobs. Models via OpenRouter and first-party providers (`src/lib/providers`).
- Route groups: `(marketing)` (~110 page routes), `(i18n)/[locale]` (7 localized pages), `(business)` / `(business-app)` (business.keplar.one), `(space)`, `/app/*` (signed-in product), `/admin/*`, `/api/*` (~330 route files).
- Deploy rules (`keplar-live/CLAUDE.md`): merges to `main` auto-deploy; never run a bare `vercel --prod`; use `npm run deploy:prod`; docs/CI/test-only changes need no deploy. Never commit `node_modules/`, `.next/`, `*.tsbuildinfo`.

### Baseline verification on `keplar-live@757eac7` (observed, this environment)

| Check | Result |
|---|---|
| `npm ci` | OK |
| `npx tsc --noEmit` | **clean** (53 s) |
| `npx eslint . --quiet` | **clean** (70 s) |
| `npm test` (409 files) | **not run yet** (needs Chromium for browser-driven tests; `npx playwright install chromium` first) |
| `npx next build` | **not run yet** (CI env values: `BETTER_AUTH_SECRET=ci-build-secret-0123456789abcdefghijklmnop BETTER_AUTH_URL=http://localhost:3199 KEPLAR_DEV_TOOLS=1 KEPLAR_MX_CHECK=off RESEND_API_KEY=`) |

---

## 3. Existing SEO infrastructure in keplar-live (observed) — build on it, do not rebuild it

| Area | Where | State |
|---|---|---|
| Per-page metadata | `src/lib/seo.ts` `pageMeta(path,title,desc,opts)` sets title, description, canonical (via `localeAlternates`), OG/Twitter, article dates, `noindex`. `OWN_SHARE_IMAGE` lists routes with file-based OG images (kept in sync by `tests/seo-meta.test.ts`). Signed titled OG cards via `src/lib/og-page.ts`. | Good |
| Root metadata | `src/app/layout.tsx`: `metadataBase`, title template `%s · Keplar`, `robots` noindex when not production, Search Console/Bing verification meta when env set, site-wide Organization+WebSite JSON-LD. | Good |
| Sitemaps | `src/app/sitemap.ts` (one file; static list + `editorialPages`, `landingPages`, `guides`, `kbPaths()` (docs, blog, glossary, prompts, use-cases, approved `/vs`), `comparePages`, showcase, localized entries with hreflang). Plus three dynamic XML routes: `answers-sitemap.xml`, `templates-sitemap.xml`, `topics-sitemap.xml` (503 on store error, not empty 200). `lastmod` is a hand-maintained map in `src/lib/content/lastmod.ts` + content front matter. | Good, but **no sitemap index** and the hand map is a maintenance risk |
| robots | `src/app/robots.ts`: allow all, disallow `/api/`, `/dev/`; named groups for 19 search/AI crawlers; lists the four sitemaps; full disallow when not indexable. Preview hosts get `X-Robots-Tag: noindex` from `next.config.ts`. | Good |
| Redirects | `next.config.ts`: `/blog→/blogs`, `/create→/app/create`, `/login→/signin`, www→apex, `/compare/best-multi-model-ai-tools→/compare`, business paths → business.keplar.one. `tests/redirect-aliases.test.ts` exists. | Good |
| Structured data | `src/lib/structuredData.ts` (Organization with two founder Person nodes, WebSite, SoftwareApplication with Offers from `tiers.ts`, FAQPage, download graph), `src/lib/seo-graph.ts` (BreadcrumbList, Article, WebPage), `src/lib/kb/jsonld.ts` (TechArticle, BlogPosting, FAQ from `## FAQ`, HowTo from `## Steps`), `src/components/seo/Breadcrumbs.tsx`, `JsonLd.tsx`. | Good |
| Content library | `content/blog` 24 posts · `content/docs` 77 files in 11 sections · `content/use-cases` 10 · `src/lib/kb/glossary.ts` (66 terms) · `src/lib/kb/prompts.ts` (48 prompts, 6 categories) · `src/lib/kb/vs.ts` (ChatGPT, Claude, Gemini approved; Perplexity noindex) · `src/lib/compare.ts` (3 approved competitor pages) · `src/lib/content/landing.ts` (ai-answer-engine, compare-ai-models, chatgpt-alternative, ai-study-tool, ai-slideshow-maker, ai-fact-check, roblox-studio-ai, blender-ai, for-* audiences) · `src/lib/content/editorial.ts` (superintelligence cluster, multi-model-ai) · `guides.ts`, `about-page.ts`, `models-page.ts`, `product-facts.ts`, `sources.ts` (dated citations). Prices in content come from `tiers.ts` tokens (`{{price:plus}}`). | Large; mapping to the 11 target clusters is pending (see §4) |
| Programmatic/public pages | `/topics/[slug]` (Google-Trends-assembled term pages from `src/lib/trends/store`, force-dynamic, kill switch, Article+FAQ JSON-LD), `/templates/[slug]` (community gallery, `src/lib/templates/store`), `/answers/[slug]` (opt-in public shared answers, `src/lib/growth/share-public`, QAPage). Private share links `/r`, `/c`, `/sp`, `/i` are noindex. | Exists; quality gates to be audited |
| AI-search (GEO) | `/llms.txt`, `/llms-full.txt` (generated from content), `/capabilities.json`, `/bot`, `/.well-known/*`, `docs.keplar.one` rewrite in `src/proxy.ts`. | Exists |
| Measurement | Consent-gated first-party funnel: `src/lib/seo/events.ts` (`landing_view` → `cta_click` → `signup_*` → `first_prompt` → `synthesis_success` → `pricing_view` → `checkout_start` → `subscription_complete`), `POST /api/seo/event`, `/admin/seo`, `/admin/growth`, `@vercel/analytics`, `@vercel/speed-insights`. IndexNow key + `scripts/indexnow.mjs`. **No Search Console API integration.** | Partial |
| SEO tests (unit) | `seo.test.ts`, `seo-meta`, `seo-indexable`, `seo-indexing`, `seo-editorial`, `seo-events`, `seo-site-checks`, `sitemap-xml`, `robots`, `og-images`, `redirect-aliases`, `kb-content` (counts, uniqueness, word counts, banned claims, US spelling, near-duplicates, internal links, orphan check, JSON-LD vs visible text, one H1, JS budget, "no blue"), `glossary-markup`, `quality-gate-structured`, `omnipresence-seo`, `llms-full`, `docs-host`, `templates`. | Strong |
| SEO tooling (scripts) | `scripts/seo-crawl.mjs` (live crawl: status, canonical, title/desc lengths, H1, OG, JSON-LD validity, broken links, orphans; `--strict` exits 1), `seo-site-issues.mjs`, `lh-mobile.mjs`, `lh-summary.mjs`, `cls-check.mjs`, `axe-audit.mjs`, `route-smoke.mjs`, `smoke-prod.mjs`, `indexnow.mjs`. | Strong, **not wired into CI** |
| CI gate | `.github/workflows/ci.yml` + `scripts/verify.mjs`: secret scan, prod dependency audit, lockfile check, security-checklist evidence, tsc, eslint, Chromium, unit tests, `next build`, build-output secret scan, SBOM. CodeQL and dependency-review workflows. | Strong |
| Prior SEO work to read first | `docs/seo/AUDIT.md` (3 Oct 2026 before/after), `docs/seo/PROGRESS.md`, `docs/seo/KEYWORDS.md` + `keywords.csv`, `docs/seo/MEASUREMENT.md`, `docs/seo/WEEKLY-REVIEW.md`, `docs/seo/CAMPAIGN.md`, `docs/seo-growth-plan.md`, `docs/seo-competitor-patterns.md`, `docs/seo-keywords.md`, `docs/seo-trends.md`, `docs/growth/SEARCH.md`, `docs/growth/*`. | Read before writing new pages |

Content rules already enforced by tests and docs (must be kept): no invented numbers, testimonials, ratings, customer counts or accuracy/confidence claims; Keplar is not AGI/superintelligence; consensus = agreement, not correctness; US English; prices only from `tiers.ts`; no blue in graphics; "Keplar One" first mention, "Keplar" after; no third-party logos.

---

## 4. Preliminary audit findings (not yet verified by the adversarial pass)

| # | Severity (prelim.) | Finding | Evidence | Planned action |
|---|---|---|---|---|
| F1 | Critical (process) | Work targeted at the wrong repository would preserve nothing: `keplar-main` has no product. | §1 | Build in `keplar-live`. |
| F2 | High | **Brand-fact inconsistency for AI search.** `organizationNode()` description says Keplar offers "a public API"; `docs/seo-growth-plan.md` (4 Oct) says `/docs/reference/developers-and-api` states there is no public API; yet `src/app/api/v1/ask`, `api/v1/openapi.json`, `api/v1/usage` and `/developers` ("API and widget") now exist. One of these is stale. | `src/lib/structuredData.ts`, `content/docs/reference/developers-and-api.md`, `src/app/api/v1/*` | Read all three, fix the stale one, add a test that product facts (`product-facts.ts`) and the docs agree. |
| F3 | High (at scale) | **No sitemap index.** One `sitemap.ts` plus three ad-hoc XML routes. A 10,000-page footprint needs a sitemap index with ≤50,000 URLs / 50 MB per file and per-cluster files; `robots.ts` hard-codes four sitemap URLs. | `src/app/sitemap.ts`, `src/app/robots.ts` | Add `/sitemap-index.xml` (or Next `generateSitemaps`) that enumerates cluster sitemaps; keep the existing URLs stable. |
| F4 | Medium | **Overlapping comparison intents across three URL families:** `/compare/*` (Perplexity Model Council, Poe, ChatHub), `/vs/*` (ChatGPT, Claude, Gemini), `/compare-ai-models` (landing), blog `chatgpt-vs-claude-vs-gemini-vs-perplexity`. Possible cannibalization and no single comparison hub. | `src/lib/compare.ts`, `src/lib/kb/vs.ts`, `src/lib/content/landing.ts`, `content/blog/` | Define the "AI model comparisons" cluster with one hub and explicit intent per page; cross-link; consider consolidating `/compare` + `/vs` hubs. |
| F5 | Medium | **Overlapping product-overview pages:** `/product`, `/what-is-keplar`, `/keplar-one`, `/features`, `/how-it-works`, `/for-you`. Several share the same intent ("what is Keplar"). | `staticLastmod` keys, `paletteOnlyPages` | Verify titles/H1s; pick one canonical per intent; redirect or `noindex` true duplicates only after reading each. |
| F6 | Medium | `lastmod` for ~45 static pages is a hand-maintained map; tests check presence and not-future, not accuracy. Stale dates reduce trust in the sitemap. | `src/lib/content/lastmod.ts` | Derive from git last-commit date of each page's source files at build time, with the map as override. |
| F7 | Medium | `/topics/*` pages are "assembled, not written by a person" from Google Trends and link to unchecked news; they carry Article schema and are indexable. Risk of thin/low-value programmatic pages. | `src/app/(marketing)/topics/[slug]/page.tsx` | Audit quality gate in `src/lib/trends/*`; require minimum unique content and library coverage before publish; keep the kill switch. |
| F8 | Medium | SEO crawl, Lighthouse, CLS and axe scripts exist but **are not in CI**; only unit-level SEO tests gate deploys. | `scripts/*.mjs`, `ci.yml` | Add a post-build local crawl (`seo-crawl.mjs --strict` against `next start`) and a JSON-LD validator step to `verify.mjs`/CI. |
| F9 | Medium | No dedicated free-tool landing pages. `/app` works without signup (`src/lib/demo-limits.ts`, `demo.ts`), Study sets, slides, summarization and prompt library exist behind `/app`. | `src/app/app/*`, `src/lib/study`, `src/lib/slides`, `src/lib/kb/prompts.ts` | Phase 4: `/tools/*` pages reusing these backends with their existing rate limits. |
| F10 | Medium | Measurement covers landing→signup→subscription in first-party events but has **no Search Console data** (impressions, clicks, CTR, position, indexed-vs-submitted) and no indexed-URL reconciliation. | `docs/seo/MEASUREMENT.md`, `src/lib/seo/events.ts` | Phase 10: Search Console API client behind `GSC_*` env (service account); `/admin/seo` sections for queries/pages and sitemap-vs-indexed. Blocked on owner credentials. |
| F11 | Low | Home-page mobile performance was unstable in the 3 Oct lab audit (WebGL particle field). Not re-measured. | `docs/seo/AUDIT.md` | Re-measure with `scripts/lh-mobile.mjs` after build; do not touch `src/field/*` without data. |
| F12 | Low | `/for-developers` title 72 chars and description 191 chars (noted 3 Oct, unverified now). | `docs/seo/PROGRESS.md` | Check with `seo-crawl`; shorten. |

Positive observations (no action): robots/noindex separation is correct; canonicals are per-page; `lastmod` is content-based; JSON-LD matches visible text by test; private share links are noindex; redirects are single-hop; i18n uses hreflang + x-default only where translations exist.

---

## 5. The audit workflow that was designed but not run

`docs/seo-engine/audit-workflow.js` (next to this file) is the UltraCode Workflow script: 13 parallel dimension readers (routes/indexability, metadata, structured data, content-to-cluster mapping, internal links, performance/rendering, tests/CI, measurement, programmatic systems, free-tool backends, AI-search facts, public-surface security, conversion/UX), then two adversarial verifiers per Critical/High finding (reproduce-in-code lens and severity/value lens), a synthesis agent, and a completeness critic. It returns the verified findings as JSON; the resume session writes `keplar-live/docs/seo/AUDIT-2026-10.md` from it. It was not executed because the owner asked to checkpoint first.

---

## 6. Implementation roadmap (pending; all in `keplar-live`)

Ordered so each step is independently testable and deployable, with the CI gate green before merge.

1. **Finish Phase 1.** Run `npm test` and `next build` baseline; run `audit-workflow.js`; write `docs/seo/AUDIT-2026-10.md`; fix F2 (brand facts) first because it affects every AI-search answer.
2. **Technical SEO architecture (Phase 2/3 foundation).** `src/lib/seo/clusters.ts`: typed registry of the 11 clusters, each with hub path, supporting pages (existing + planned), product route (`/app/ask`, `/app/study`, `/app/slides`, `/app/create`), and a per-cluster sitemap. Sitemap index route; `robots.ts` reads the list. `src/lib/seo/quality.ts`: page-level gates (unique title/description/H1, ≥N words, ≥K internal links, near-duplicate check reusing `kb-content` logic) used by both build-time tests and the programmatic publishers. Breadcrumb trail derived from cluster membership.
3. **Cluster hubs and templates (Phase 2).** One hub page per cluster (`/learn/<cluster>` or reuse existing hubs: `/compare` for comparisons, `/ai-study-tool`+`/docs/using-keplar/study-mode` for study, `/prompts` for prompt optimization, `/models` + `/pricing` for pricing/capabilities, `/guides` for tutorials). Reuse `kb.module.css` and the landing template; no new visual language.
4. **Programmatic engine (Phase 3).** Generalize the `topics`/`templates` publish pipeline: content record → quality gate → publish/unpublish → sitemap membership → IndexNow ping. Pagination with `rel` links on hubs; `noindex` for below-threshold pages; duplicate detection via shingling (extend `kb-content` near-duplicate check to runtime data).
5. **Free tools (Phase 4).** `/tools/<slug>` pages (prompt optimizer, study guide, flashcards, research questions, presentation outline, summarizer, model comparison explorer, writing improver, citation formatter, learning plan) calling existing endpoints under the demo limits and consent rules; FAQ + examples + HowTo JSON-LD; CTA into the matching `/app/*` tab. Respect `src/lib/create/platform/ratelimit`, cost guard cron and moderation.
6. **AI search visibility (Phase 5).** Reconcile `product-facts.ts`, `llms.txt`, Organization/SoftwareApplication, pricing page and docs; add a facts consistency test.
7. **Research reports (Phase 6).** `content/reports/*.md` + `/reports/[slug]` template with required Methodology, Data, Limitations, Reproduce sections (schema `Report`/`Dataset`); the first report only from real, reproducible runs (e.g. `bench/`, `docs/core-eval-results.json`) with limitations stated. No fabricated results.
8. **Public sharing (Phase 7).** Audit `share-public`, `templates/store` for consent, default-private, PII scan, takedown, noindex rules; add tests where missing.
9. **Conversion (Phase 8).** CTA and signup-friction review on hubs/tools; keep the existing minimal design; measure with existing `cta_click`/`signup_*` events.
10. **SEO QA in CI (Phase 9).** Add to `verify.mjs` and `ci.yml`: post-build crawl (`seo-crawl.mjs --strict`), JSON-LD schema validation, alt-text check, redirect-chain check, tool smoke tests; failures block the deploy.
11. **Measurement (Phase 10).** Search Console API (owner must create a service account and add it to the property), CWV from Speed Insights, indexed-vs-submitted report, organic attribution joined to `subscription_complete` and Whop webhooks (`/admin/growth`).
12. **Verify and ship (Phase 11).** `npm run verify`, then PR to `keplar-live@main`; after merge, Vercel deploys; verify `https://keplar.one/deploy-stamp.json` and crawl live with `scripts/seo-crawl.mjs https://keplar.one --strict`; submit IndexNow.

Blocked on the owner: Search Console and Bing verification/API credentials; approval of any new competitor comparison page; branch/PR preference on `keplar-live`.

---

## 7. Continuation instructions (exact)

Run these in a fresh session started on `keplarone/keplar-main`, branch `claude/inspiring-hypatia-meru1j`:

1. Read this file and `docs/seo-engine/audit-workflow.js`.
2. Attach the product repo and clone it (one clone, ~10-minute timeout):
   ```
   add_repo(owner="keplarone", repo="keplar-live", access="push")
   git clone --depth 1 https://github.com/keplarone/keplar-live /home/user/keplar-live
   register_repo_root(owner="keplarone", repo="keplar-live", directory="/home/user/keplar-live")
   ```
3. Install and confirm the baseline still holds:
   ```
   cd /home/user/keplar-live && npm ci --no-audit --no-fund
   npx tsc --noEmit && npx eslint . --quiet
   npx playwright install chromium
   npm test
   BETTER_AUTH_SECRET=ci-build-secret-0123456789abcdefghijklmnop BETTER_AUTH_URL=http://localhost:3199 KEPLAR_DEV_TOOLS=1 KEPLAR_MX_CHECK=off RESEND_API_KEY= npx next build
   ```
4. Create the working branch: `git -C /home/user/keplar-live checkout -b claude/seo-intent-engine origin/main` (or the branch the owner names).
5. Run the audit: `Workflow({ script: <contents of audit-workflow.js>, args: { repo: "/home/user/keplar-live", date: "<today>" } })`. Write the result to `keplar-live/docs/seo/AUDIT-<date>.md` with Critical/High/Medium/Low.
6. Implement roadmap steps 2–11 in order; after each: `npm run verify:quick`, commit on the working branch, update `keplar-live/docs/seo/PROGRESS.md` and this checkpoint, push with `git push -u origin <branch>`.
7. Open one PR to `keplar-live@main` per completed, verified phase. Deploy only after CI is green and per `keplar-live/CLAUDE.md`.

Do not repeat: repository discovery, dependency install investigation, reading of the files listed in §3 (summaries above are accurate as of `757eac7`).
