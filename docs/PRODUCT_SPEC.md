# Product specification

**Promise:** "Tell Keplar what you want. Keplar gets it done." Keplar One turns a natural-language goal into an approved plan, runs the parts it can run, verifies the results independently, and issues an outcome receipt. It says plainly what it cannot do.

## Primary journey (implemented in this slice)

1. **Goal.** The user answers one question: *What do you want accomplished?*
2. **Plan.** Keplar interprets the goal (research, document or checklist), detects capability gaps, and shows a task graph: each step, what it does, what it depends on, its budget, and the checks that will decide whether it worked.
3. **Authorization.** Nothing runs until the user approves *that exact plan* (identified by a SHA-256 plan hash). Approval reserves credits; the user sees permissions in plain language and the reserved cost against their balance.
4. **Execution.** A background worker runs approved steps. It survives the browser closing; the page just polls.
5. **Verification.** Each step's persisted output is checked against acceptance criteria that were fixed at planning time. A model's or a capability's claim of success is not evidence.
6. **Outcome receipt.** An immutable JSON record of what completed and was verified, what failed, what was blocked, artifacts with digests, actual cost, and what is left for the human. Its digest is re-checked in the browser.

## What Keplar can execute today

| Capability | What it does | Real or simulated |
|---|---|---|
| `web.fetch` | Reads public web pages the user listed, keeps a snapshot with a digest | Real HTTP, SSRF-guarded |
| `doc.compose` | Writes a brief or a research brief citing every source | Real. Uses Claude when `ANTHROPIC_API_KEY` is set; otherwise a deterministic template composer, labelled as such in the document, the UI and the receipt |
| `checklist.compose` | Writes an ordered action checklist | Same as above |

Detected but **not executable** (shown as blocked with a follow-up): payments, booking, sending messages, deployment, app code generation, and research without links (no search provider is connected).

## Plans (configurable hypotheses, see PRICING_AND_UNIT_ECONOMICS.md)

Free $0 · Pro $39 · Plus $99 · Business $299 · Enterprise from $1,500. Limits live in `apps/server/src/billing/plans.ts` and are enforced server-side. Billing (Stripe) is not implemented yet, so every workspace is on Free.

## Out of scope for this slice

Team workspaces, integrations (GitHub, Google), the app builder, scheduled runs, marketplace, billing. See IMPLEMENTATION_STATUS.md for the roadmap.
