# Synthetic MCP adapter — integration rehearsal

The first integration adapter is intentionally **in-process and synthetic**. It does not connect to a real MCP server, GitHub, Azure DevOps, an AI provider or Adobe AEM.

`createSyntheticMcpAdapter(report)` accepts a local `WorkbenchReport` and exposes the four read-only tools already allowlisted by the Maestro dispatcher: `source.list`, `source.read`, `target.preview`, `job.status`.

The three job-specific tools are routed through `ConnectorRegistry` and `createSyntheticReportConnector`. `source.list` enumerates only job IDs and statuses. The synthetic source response intentionally excludes raw source content. Preview is always `publishable: false`.

Unknown jobs and unsupported write tools return sanitized failures. The adapter has no network, credentials, filesystem writes, publication permissions or remote transport.

## Next integration prerequisites

A real MCP transport and external adapters require a separate, explicit authorization boundary, authentication, allowlisted tenant/repository IDs, credential isolation, request/response size limits, timeouts, rate limits, audit logs, and review of the data exposure contract. A Maestri.app review does not grant remote access or publication permission.

Run `npm run check && npm test` locally.
