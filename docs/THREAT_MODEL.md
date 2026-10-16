# Threat model (STRIDE, slice scope)

Assets: user credentials and sessions; workspace data (goals, artifacts, receipts); credit balances; provider API keys; worker capacity.

Trust boundaries: browser ↔ API; API/worker ↔ Postgres; worker ↔ public web (untrusted); worker ↔ model provider (untrusted output).

| Threat | Example | Mitigation | Residual risk |
|---|---|---|---|
| **S**poofing | Stolen session cookie | HttpOnly, SameSite, Secure/`__Host-`, revocation on logout, hashed at rest | No device binding or MFA |
| **S**poofing | Credential stuffing | Argon2id, 10/min/IP auth limit, uniform errors | Distributed attacks bypass per-IP limits |
| **T**ampering | Approving a different plan than shown | Approval must present the plan hash | — |
| **T**ampering | Altered artifact or receipt | SHA-256 stored at write, re-verified by verifier and in the browser | Digests are not signed; an attacker with DB write access could recompute them |
| **T**ampering | Zombie worker overwrites newer results | Attempt-number fencing on every commit | — |
| **R**epudiation | "I never approved that" | `approved_by`, `approved_at`, transition log, receipt | Logs are in the same database |
| **I**nformation disclosure | Cross-tenant reads by guessing ids | Workspace-scoped queries, 404 on foreign ids | No RLS second layer yet |
| **I**nformation disclosure | SSRF to cloud metadata (169.254.169.254) or internal services | Connect-time address checks, redirect re-validation | IPv6 transition mechanisms beyond IPv4-mapped not exhaustively tested |
| **I**nformation disclosure | Fetched page exfiltrates data via the model | Plan fixed before fetch; no tool can send data out; outputs are documents only | When outbound capabilities arrive, they need per-call approval |
| **D**enial of service | Huge pages, slow servers | 2 MiB cap, 15 s timeout, task timeouts | Single shared worker pool per deployment |
| **D**enial of service | Planning spam | Rate limits + monthly request quota | — |
| **E**levation of privilege | Prompt injection instructs the agent to act | Agents cannot create tasks or call tools beyond the approved capability | — |
| **E**levation of privilege | XSS via artifact content | No HTML rendering of artifacts, strict CSP | — |
