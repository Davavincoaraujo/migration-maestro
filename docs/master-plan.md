# Migration Maestro — agreed scope and delivery tracking

Status: early independent prototype, **not** a completed production migration platform.
No corporate code, content, credentials, endpoints, model IDs or production AEM access in this repository.

## Scope and acceptance gates

| Workstream | Acceptance criterion | Status |
| --- | --- | --- |
| Core and agents | Discover → analyze → transform → validate → human review with traceable job ID | Prototype |
| Autopilot | Bounded retries, concurrency, budgets, cancellation, cache and recoverable stage checkpoints | Partial: bounded retries and checkpoint runner; concurrency/budgets/cancel/cache pending |
| Registry intelligence | Discover evaluated component definitions, reuse existing React/Next.js/AEM models, nested containers | Partial: sanitized topology only; no live portal integration |
| Legacy analyst | URL ingestion, Playwright evidence, DOM and screenshots, Lighthouse quality baseline | Pending |
| Page composition | PageCompositionPlan and approved mapping to existing AEM model.json/JCR serialization | Partial: structural matching and primitive dry-run; no real JCR adapter |
| MCP / specialized executor | Real MCP server, tool permissions, isolated ue-pattern executor, contract tests | Partial: contracts only |
| AEM execution | Draft creation/validation with approved enterprise adapter, explicit write permission, idempotency | Pending; no writes enabled |
| Quality and governance | Screenshot comparison, accessibility, SEO, links, Lighthouse, policy checks, review/PR gates | Partial: validation and review prototypes |
| Observability | Per-job event trace, durations, tokens, calls, BRL cost, errors, rework, quality, human baseline | Partial: event records only |
| Queue and memory | PostgreSQL, Redis/BullMQ, concurrency/leases, short/long memory, pgvector | Pending |
| AI routing | Provider-independent model routing, token/cost budgets, prompt cache, resilience | Pending |
| Reporting | JSON/Markdown Jira handoff, metrics exports, Electron/React desktop reports | Pending |
| UI | Chat inside Universal Editor after the core pipeline | Later phase |
| Security | No secrets or proprietary data in personal GitHub; approval before corporate write/publish | Enforced by project boundary; production controls pending |

## Intended demonstration

One synthetic URL-like input → evidence → component selection → PageCompositionPlan → preview → validations → cost/time report → human review, with a reproducible checkpointed rerun. This is **not achieved yet**.

## Milestone order

1. Complete checkpointed runner, persistent checkpoints, execution budgets and local test harness.
2. Implement synthetic legacy evidence, registry-based composition plans, validation and Jira JSON/Markdown export.
3. Introduce MCP server with explicit read-only tool allowlist and simulated ue-pattern executor.
4. Add model routing, metrics, trace/event export, caching and bounded parallel queue.
5. Add Playwright/Lighthouse adapters and enterprise-only integration contracts for model.json and AEM writer.
6. Add PostgreSQL/Redis optional deployment, Electron/React dashboard and real provider adapters.
7. Validate a single end-to-end pilot in an approved enterprise environment before enabling any writes.

## Release policy

Personal GitHub is a **synthetic-only** implementation. Merge via reviewed changes and independent local tests where possible; GitHub Actions is unavailable on this account. A successful GitHub merge alone does not mean tests passed. Enterprise credentials, private source, production publishing and security bypasses are out of scope.
