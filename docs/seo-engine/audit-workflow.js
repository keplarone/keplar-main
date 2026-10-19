// UltraCode Workflow script for Phase 1 of the Search Intent Domination Engine.
// Run with: Workflow({ script: <this file>, args: { repo: "/home/user/keplar-live", date: "YYYY-MM-DD" } })
// Returns { dimensions, verified, synthesis, critic } as JSON; the caller writes docs/seo/AUDIT-<date>.md from it.
export const meta = {
  name: 'keplar-seo-audit',
  description: 'Thirteen-dimension SEO audit of keplar-live, adversarially verified, then synthesized',
  phases: [
    { title: 'Audit', detail: 'one reader per dimension, structured findings' },
    { title: 'Verify', detail: 'two lenses per Critical/High finding' },
    { title: 'Synthesize', detail: 'prioritized audit + completeness critic' },
  ],
}

const REPO = (args && args.repo) || '/home/user/keplar-live'
const DATE = (args && args.date) || 'unknown date'
const VERIFY_PER_DIM = 4

const CONTEXT = `You are auditing the production codebase of keplar.one (Next.js 16 App Router) at ${REPO} on ${DATE}, for a program whose goal is qualified organic search discovery and conversion. READ ONLY: do not modify any file. Observed facts only; never invent traffic, rankings, volumes or indexing states. Cite every finding with a repo-relative file path and, where possible, a line or symbol. Existing SEO infrastructure (do not propose rebuilding it): src/lib/seo.ts pageMeta(); src/app/sitemap.ts plus answers-/templates-/topics-sitemap.xml routes; src/app/robots.ts; src/lib/structuredData.ts, seo-graph.ts, kb/jsonld.ts; content/**/*.md loaded by src/lib/kb/*; src/lib/content/*.ts (landing, editorial, guides, lastmod, product-facts); src/lib/compare.ts; tests/seo-*.test.ts, kb-content.test.ts; scripts/seo-crawl.mjs; docs/seo/*. Prior audit: docs/seo/AUDIT.md (3 Oct 2026). Content rules enforced by tests: no invented numbers or testimonials, no accuracy/confidence claims, Keplar is not AGI, prices only from src/lib/tiers.ts, US English, no blue in graphics.`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What exists and works in this dimension, 5-12 sentences' },
    inventory: { type: 'string', description: 'Counts and key files observed' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          category: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string', description: 'What was read, quoted briefly' },
          impact: { type: 'string', description: 'Effect on discovery, indexing, trust or conversion' },
          recommendation: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
        },
        required: ['id', 'title', 'severity', 'category', 'files', 'evidence', 'impact', 'recommendation', 'effort'],
      },
    },
  },
  required: ['summary', 'inventory', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    correctedSeverity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
  },
  required: ['refuted', 'confidence', 'reasoning', 'correctedSeverity'],
}

const DIMENSIONS = [
  { key: 'routes-indexability', prompt: `Enumerate every page.tsx under src/app excluding /admin, /app and /api. For each public route determine: sitemap membership (src/app/sitemap.ts, src/lib/kb/paths.ts, the three *-sitemap.xml routes, src/lib/i18n/sitemap.ts), metadata source (pageMeta or hand-written), canonical, noindex (metadata robots, X-Robots-Tag in next.config.ts / src/lib/security/headers.ts / src/proxy.ts), dynamic vs static rendering, redirects (next.config.ts redirects(), src/proxy.ts). Report: public routes missing from the sitemap that look indexable; sitemap URLs that are noindex, redirect or 404; missing canonicals; redirect chains; URL families serving the same intent; i18n (src/app/(i18n)) coverage and hreflang correctness.` },
  { key: 'metadata-quality', prompt: `Collect every export const metadata / generateMetadata in src/app (public pages) and the data they read (src/lib/content/landing.ts, editorial.ts, guides.ts, compare.ts, kb loaders, templates/topics/answers stores). Check title length (target <= 60 chars including the " · Keplar" template suffix), description length (70-160), duplicates across pages, double suffixes, missing OG/Twitter images, OWN_SHARE_IMAGE vs files on disk, signed og-page URLs. Report concrete pages and values.` },
  { key: 'structured-data', prompt: `Audit every JSON-LD emitter: src/lib/structuredData.ts, seo-graph.ts, kb/jsonld.ts, src/components/seo/*, inline JsonLd usages in src/app. Check against schema.org and Google structured-data guidelines: required properties, @id reuse and duplicates across root layout and pages, BreadcrumbList on every content page, FAQPage only for visible FAQs, SoftwareApplication offers vs src/lib/tiers.ts, Organization sameAs, Article/BlogPosting author and image, HowTo. Check which tests validate JSON-LD against visible content (tests/kb-content.test.ts, quality-gate-structured.test.ts, seo-editorial.test.ts) and what is not covered.` },
  { key: 'content-clusters', prompt: `Inventory all public content: content/**/*.md (front matter: title, description, dates, words), src/lib/kb/{glossary,prompts,vs}.ts, src/lib/compare.ts, src/lib/content/{landing,editorial,guides,about-page,models-page}.ts, showcase data, use cases. Map every page to one of these target clusters: AI model comparisons; AI studying and education; AI reasoning and research; AI presentations and slides; AI image generation; AI video generation; AI writing and summarization; AI productivity; AI prompt optimization; AI model pricing and capabilities; AI tutorials and workflows; or Other. For each cluster report: existing hub page (if any), supporting pages, product route it should lead to (/app/ask, /app/study, /app/slides, /app/create, etc.), and gaps. Flag thin pages (< 300 words of unique body), near-duplicate intents (same query answered by two URLs), and stale "updated" dates older than 90 days on fast-moving topics.` },
  { key: 'internal-linking', prompt: `Analyze the link graph: src/lib/site.ts (primaryNav, footerNav, paletteOnlyPages), src/components/seo/Breadcrumbs.tsx usage, "related" arrays in landing/editorial/guides, hub pages (/guides, /docs, /blogs, /use-cases, /prompts, /glossary, /vs, /compare, /topics, /templates, /answers, /showcase), the Go-deeper cards, and the orphan check in tests/kb-content.test.ts and scripts/seo-site-issues.mjs. Report: hubs not reachable from nav or footer; clusters with no cross-links; list pages without pagination (blogs, templates, answers, topics) and whether they would scale to thousands of items; pages whose only inbound link is the sitemap; breadcrumb trails that do not match the URL hierarchy.` },
  { key: 'performance-rendering', prompt: `Assess rendering and performance of public pages: src/app/layout.tsx (inline scripts, fonts, client components mounted site-wide), src/app/(marketing)/layout.tsx, use of "use client" and dynamic = "force-dynamic" on marketing routes, next/image and alt text, third-party scripts (WhopPixel, analytics), service worker (public/sw.js, StaticAssetSw), the home-page WebGL field (src/field, three.js), CLS risks, scripts/lh-mobile.mjs, cls-check.mjs, perf-measure.mjs and docs/perf-progress.md. Report which content pages are server-rendered with full text in HTML and which depend on JS; marketing routes that are force-dynamic without need; images missing alt; known lab results in docs. Do not run Lighthouse.` },
  { key: 'tests-ci', prompt: `Inventory what SEO quality is enforced automatically: every tests/*seo*, kb-content, robots, sitemap-xml, og-images, redirect-aliases, seo-site-checks, glossary-markup, quality-gate-structured, llms-full, docs-host, templates tests; scripts/verify.mjs; .github/workflows/ci.yml; scripts/seo-crawl.mjs, seo-site-issues.mjs, axe-audit.mjs, lh-*.mjs, cls-check.mjs, route-smoke.mjs, smoke-prod.mjs. Against this required list, say for each whether it is checked, where, and whether a failure blocks deploy: broken links, invalid structured data, duplicate metadata, missing canonical, incorrect indexing directives, sitemap inconsistencies, inaccessible navigation, missing image alt text, performance regressions, incorrect redirects, broken tool functionality, content duplication, security regressions.` },
  { key: 'measurement', prompt: `Audit measurement: src/lib/seo/events.ts, src/lib/seo-events.ts, src/app/api/seo/event, src/app/admin/seo, src/app/admin/growth, src/lib/analytics.ts, src/lib/utm.ts, src/lib/consent.ts, @vercel/analytics and @vercel/speed-insights usage, scripts/indexnow.mjs, docs/seo/MEASUREMENT.md, billing webhooks (src/app/api/webhooks/whop, src/lib/billing) for how a paid conversion could be joined to the landing page. Against this required list say what exists and what is missing: organic impressions, clicks, CTR, average position, indexed vs submitted URLs, landing-page engagement, organic signups, organic paid conversions, revenue attributed to organic, tool usage/activation, Core Web Vitals. Identify where a Google Search Console API integration would plug in and what env/credentials it needs.` },
  { key: 'programmatic-systems', prompt: `Audit the three programmatic/public page systems as a foundation for 10,000+ quality-gated pages: topics (src/lib/trends/*, src/app/(marketing)/topics, src/app/api/cron/observatory), templates (src/lib/templates/*, /templates pages, templates-sitemap), public answers (src/lib/growth/share-public*, share-guard, /answers pages, answers-sitemap). For each: how a page is created, the quality gate, consent/default-private, PII/secret scanning, duplicate and spam prevention, unpublish/delete, noindex rules, kill switch, caching (force-dynamic?), sitemap and IndexNow integration, tests. Report gaps for scaling: sitemap index, pagination, duplicate detection, content minimums, structured data validation, rate of publishing.` },
  { key: 'free-tools-backend', prompt: `For each proposed free tool (AI Prompt Optimizer, Study Guide Generator, Flashcard Generator, Research Question Generator, Presentation Outline Generator, Text Summarizer, Model Comparison Explorer, Writing Improvement Tool, Citation Formatter, Learning Plan Generator) find the existing backend that could power it: src/app/api/keplar/*, api/study/*, api/slides/*, api/embed/ask, api/v1/ask, src/lib/study, src/lib/slides, src/lib/kb/prompts.ts, src/lib/providers, models registry (src/lib/tiers.ts, docs model roster), src/lib/demo-limits.ts, demo.ts, src/lib/create/platform/ratelimit.ts, cost guard cron, moderation. Report per tool: reusable endpoint or library, whether anonymous use is already allowed and how it is limited, inference cost and abuse constraints, and feasibility (feasible now / needs new endpoint / not advisable). Note anything that would be a fake or misleading free offer.` },
  { key: 'ai-search-facts', prompt: `Check that the facts machines read about Keplar agree with each other: src/lib/content/product-facts.ts, src/app/llms.txt and llms-full.txt routes, src/app/capabilities.json, src/app/bot, src/lib/structuredData.ts (Organization description, SoftwareApplication featureList and offers), src/lib/site.ts, /what-is-keplar, /pricing page and src/lib/tiers.ts, /models page and content/docs/reference/model-roster.md, content/docs/reference/developers-and-api.md vs src/app/api/v1/* and /developers page, content/docs/get-started/what-keplar-cannot-do.md, /features live/beta flags (src/lib/features.ts). Report every contradiction or stale statement with both sources quoted (for example "public API" vs "no public API", web search live vs not, plan names and prices).` },
  { key: 'public-surface-security', prompt: `Identify the security constraints any new public SEO page or free tool must respect: src/proxy.ts (origin checks, rate limits, body caps), src/lib/security/headers.ts and next.config.ts CSP (what script/style/connect sources are allowed on marketing pages), src/lib/create/platform/ratelimit.ts, src/lib/consent.ts, X-Robots and noindex on share links (/r, /c, /sp, /i), src/lib/safe-href.ts and TrackedLink (open-redirect safety), src/app/api/keplar/link (SSRF guard), api/seo/event, api/embed/ask, api/feedback, moderation and abuse routes, docs/security-policy.md and docs/threat-model.md. Report the rules as a checklist and any existing public endpoint that lacks rate limiting or consent handling.` },
  { key: 'conversion-ux', prompt: `Review the conversion path from organic landing to product: landing template components for src/lib/content/landing.ts pages, src/components/growth/TrackedLink.tsx, hero CTAs, /signup and /welcome flows (src/app/(marketing)/signup, src/app/welcome, src/lib/onboarding), /pricing, src/lib/upsell.ts, upgrade-copy.ts, the design tokens (src/styles/tokens.css, src/components/kb/kb.module.css, docs/principles.md, docs/shape-system.md, docs/design-progress.md) and mobile rules (docs/mobile-progress.md). Report: CTA placement and copy consistency across hubs, signup friction (fields, verification), trust elements present (security page, pricing clarity), anti-patterns to avoid per the design docs, and the exact components a new hub/tool page template should reuse so it matches the existing visual identity.` },
]

phase('Audit')
log(`Auditing ${DIMENSIONS.length} dimensions of ${REPO}`)
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(`${CONTEXT}\n\nDIMENSION: ${d.key}\n\n${d.prompt}\n\nReturn structured findings. Severity guide: Critical = blocks indexing, leaks private data, or misstates the product to machines; High = measurably hurts discovery or conversion on many pages; Medium = quality or scale risk; Low = polish.`, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA, effort: 'high' })
    .then((r) => (r ? { ...r, key: d.key, findings: r.findings.map((f, i) => ({ ...f, id: `${d.key}-${i + 1}` })) } : null)),
  async (dim) => {
    if (!dim) return null
    const toVerify = dim.findings.filter((f) => f.severity === 'Critical' || f.severity === 'High')
    const rest = dim.findings.filter((f) => !(f.severity === 'Critical' || f.severity === 'High')).map((f) => ({ ...f, verdict: 'unverified' }))
    // The host runs min(16, cpus-2) agents at a time (2 on a 4-CPU box), so verification is one combined lens per finding,
    // Critical first, at most VERIFY_PER_DIM per dimension; the rest are kept as "unverified" and counted in the log.
    const order = { Critical: 0, High: 1 }
    const ranked = [...toVerify].sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2))
    const chosen = ranked.slice(0, VERIFY_PER_DIM)
    const skipped = ranked.slice(VERIFY_PER_DIM).map((f) => ({ ...f, verdict: 'unverified' }))
    if (skipped.length) log(`${dim.key}: ${skipped.length} High finding(s) left unverified (cap ${VERIFY_PER_DIM})`)
    const verified = await parallel(chosen.map((f) => async () => {
      const v = await agent(`${CONTEXT}\n\nVerify this audit finding by reading the cited files. First try to REFUTE it: refuted=true if the evidence does not exist as described, the code already handles it, or you cannot confirm it. If it stands, judge whether its severity is right for a program optimizing qualified organic discovery and conversion (would fixing it change what search engines or AI answer engines discover, index or say about Keplar, or what visitors do?) and set correctedSeverity.\n\n${JSON.stringify(f, null, 2)}`, { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'medium' })
      if (!v) return { ...f, verdict: 'unverified' }
      if (v.refuted && v.confidence !== 'low') return { ...f, verdict: 'refuted', refutation: v.reasoning }
      return { ...f, severity: v.correctedSeverity, verdict: 'confirmed', verifyNote: v.reasoning }
    }))
    const rest2 = [...rest, ...skipped]
    return { ...dim, findings: [...verified.filter(Boolean), ...rest2] }
  },
)
const dims = results.filter(Boolean)
log(`Dimensions complete: ${dims.length}/${DIMENSIONS.length}`)
const all = dims.flatMap((d) => d.findings)
const confirmed = all.filter((f) => f.verdict === 'confirmed')
const refuted = all.filter((f) => f.verdict === 'refuted')
log(`Findings: ${all.length} total, ${confirmed.length} confirmed, ${refuted.length} refuted, ${all.length - confirmed.length - refuted.length} unverified (Medium/Low)`)

phase('Synthesize')
const synthesis = await agent(`${CONTEXT}\n\nYou have the complete audit below. Write the prioritized audit document in Markdown for keplar-live/docs/seo/AUDIT-${DATE}.md: a 10-line executive summary; a table per severity (Critical, High, Medium, Low) with id, finding, files, recommendation, effort; a "Refuted or downgraded" section listing refuted ids with the refutation; a cluster coverage matrix (11 clusters x hub/supporting/product route/gaps); and an implementation order that fixes Critical and High first and groups work by file. Observed facts only; no traffic or ranking claims. Return only the Markdown.\n\n${JSON.stringify({ dims: dims.map((d) => ({ key: d.key, summary: d.summary, inventory: d.inventory })), findings: all }, null, 1)}`, { label: 'synthesize', phase: 'Synthesize', effort: 'high' })

const critic = await agent(`${CONTEXT}\n\nYou are the completeness critic. Here is the audit document and the dimension summaries. What is missing: a dimension not covered, a claim without a file citation, a required check from the program (sitemap index, breadcrumbs, canonical, indexing controls, duplicate detection, structured-data validation, free-tool feasibility, measurement, CI gates) with no finding either way, or a finding that contradicts another? List each gap with what to read to close it. Return Markdown.\n\n${synthesis}\n\n${JSON.stringify(dims.map((d) => ({ key: d.key, summary: d.summary })), null, 1)}`, { label: 'critic', phase: 'Synthesize', effort: 'high' })

return { dimensions: dims, verified: confirmed, refuted, synthesis, critic }
