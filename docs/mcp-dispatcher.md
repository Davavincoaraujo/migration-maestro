# Read-only MCP dispatcher and ue-pattern simulator

`createReadDispatcher` implements an **in-process** dispatcher for four allowlisted read tools: `source.list`, `source.read`, `target.preview`, and `job.status`. A handler must be explicitly provided; unknown or write-oriented tools are rejected. Exceptions are reduced to generic error codes to avoid accidental leakage.

`simulateUePattern` checks a synthetic PageCompositionPlan and returns a proposal result. It **never writes to AEM**.

**Not yet implemented:** MCP JSON-RPC/stdio or HTTP transport, client authentication, rate limits, enterprise authorization, real ue-pattern execution, distributed job queue, JCR serialization, or real source access. A future server must apply authentication, scoped permissions, strict tool-specific argument schemas, and audit logs before exposing this dispatcher.
