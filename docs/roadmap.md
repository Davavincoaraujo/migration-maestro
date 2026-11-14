# Roadmap
## Phase 1 — Prototype (implemented in this PR)
- Generic migration agents and CLI
- Opt-in local autopilot batch mode
- In-memory job checkpoints, deterministic job IDs, retries and event trail
- MCP allowlist contract and external adapter interfaces
- Unit tests and CI definition

## Phase 2 — Integration (not implemented)
- Persistent job store and distributed locking
- Read-only legacy/AEM connectors with dry-run snapshots
- Next.js component registry with AEM resourceType mapping
- Model validation against UE component schemas
- MCP server with authentication, typed input validation and audit
- GitHub issue/PR creation with review gates

## Phase 3 — Controlled production readiness (not implemented)
- Observability, backoff, cancellation and rate limiting
- Security review, secrets management and data classification
- Content diffs, SEO redirects/canonicals, accessibility checks
- Approved publishing adapter and environment promotion controls

No unattended publishing, merging or privileged external actions.
