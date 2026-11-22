# Integration readiness boundary (synthetic)

This milestone introduces two independent contracts:

- `MaestroEventJournal` provides bounded, ordered, in-memory events: `run.started`, `job.stage.completed`, `job.checkpoint.reused`, `job.finished`, `run.completed`, `run.failed`. Events contain sanitized IDs and stage metadata, never source content or credentials; operational status is surfaced through Maestri.app and durable checkpoints.
- `ConnectorRegistry` defines a narrow, deny-by-default adapter contract with capabilities `source.read`, `target.preview` and `job.status`. No write/publish capability exists. The registry does not open network connections or load credentials.

**Not yet connected:** real MCP servers, Azure DevOps, GitHub APIs, AEM, AI model providers. The connector contract is preparatory only. A real integration will require explicit authentication, tenant/repository allowlists, secret handling, timeouts, rate limits, audit logging and human authorization. Existing local review is not authenticated.

The journal is not a durable queue; its memory is lost on restart and it retains at most 1,000 events. Cursor polling is not SSE/WebSocket. This keeps the synthetic harness small while integration contracts are validated.

Run `npm run check && npm test` locally before using the new endpoint.
