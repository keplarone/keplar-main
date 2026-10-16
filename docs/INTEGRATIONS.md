# Integrations

| Integration | Status | Notes |
|---|---|---|
| Anthropic (Claude) | **Adapter implemented, not exercised against the live API.** | Official `@anthropic-ai/sdk`. Enabled only when `ANTHROPIC_API_KEY` is set. Refusals, truncation and empty output are failures. Unit-tested with a fake client; no live call has been made from this repository. |
| Public web (read) | **Implemented and tested** | SSRF-guarded GET of URLs the user put in the goal. |
| OpenAI, Google | Not implemented | Deliberately absent from the model registry so the router cannot select them. |
| Web search | Not implemented | Research without links is blocked with a follow-up. |
| GitHub, Google Drive, Gmail, Calendar | Not implemented | Planned via OAuth with minimum scopes, encrypted token storage and user-initiated disconnect. |
| Stripe billing | Not implemented | See IMPLEMENTATION_STATUS.md. Credits are enforced; payments are not collected. |
| Deployment platforms | Not implemented | Detected as a capability gap. |

## Adding an integration

1. Add a capability spec in `capabilities/catalog.ts` (permissions, base cost, timeout, attempts).
2. Implement the handler: honour `ctx.signal`, throw `PermanentTaskError` for non-retryable failures, return artifacts plus evidence (provider confirmation ids go in evidence and, for external writes, in `externalConfirmations`).
3. Define verification criteria that read real state (e.g. fetch the created resource back), never the provider's success message alone.
4. For irreversible actions: an idempotency key per task attempt, a state check before any retry, and an explicit per-action approval.
5. Tests: isolated tests with fakes, plus a separately-run live integration test gated on credentials.
