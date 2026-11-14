# Architecture — MVP

Pipeline: discovery → transformation → validation → human review → (future) publishing.

- **Orchestrator**: `runMaestro` limits batch size and runs deterministic agents.
- **Autopilot**: opt-in batch execution; does not approve, merge, deploy or publish.
- **Adapters (future)**: legacy source reader, AEM model.json / UE writer, Next.js component registry, MCP tool interface.
- **GitHub (future)**: issue/PR generation with CI checks and reviewer approval.
- **Traceability (future)**: job IDs, per-page checkpoints, idempotency, audit events and retries.

Current transformer emits a deliberately generic `demo/components/text` model, **not** a production AEM integration. No AEM, MCP, AI provider or deployment connection is implemented yet.
