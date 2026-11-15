# Maestro Core — incremental refactor

## Decision
The Maestro Core is a provider-agnostic workflow engine. Maestri is an optional operator interface, not a required runtime dependency. Migration Analyst and UE Pattern remain specialized adapters/workflows. The existing `src/integrations` and CLI commands remain unchanged during the transition.

## Boundaries
- `src/core/contracts`: stable data contracts for workflows, tasks, runs, agents, models, tools, approvals and evidence.
- `src/core/workflow`: pure workflow validation and planning; no execution or network I/O.
- Future `src/core/policies`: explicit authorization and tool-effect checks.
- Future `src/core/execution`: durable transitions, retries and cancellation.
- Future `src/adapters`: provider-specific MCP, Claude Code, Codex and optional Maestri integration.
- Future `src/workflows/migration`: migration-specific planning built on core contracts.

## Security invariants
- No tool execution as a side effect of constructing a plan.
- Reading or inspecting does not authorize writing, code execution or publication.
- Every sensitive transition requires an explicit approval tied to a run and task.
- Corporate artifacts and raw evidence remain local; never push to personal GitHub.
- Models and agent outputs are untrusted; adapters must enforce policies.
- Maestri integration requires verification of supported local interfaces. No assumed API.

## Migration strategy
1. Add contracts and pure validation with synthetic tests (this PR).
2. Add durable workflow state and policy engine, with tests for denied operations.
3. Add agent registry and model routing independent of any provider.
4. Wrap existing MCP and Claude Code integrations as adapters.
5. Add optional Maestri bridge only after validating its documented capabilities.
6. Move migration into an optional workflow and preserve old CLI entrypoints until parity.

## Acceptance for phase 1
- `npm run check` and `npm test` pass locally.
- A generic workflow can be validated and planned without importing migration modules.
- Cyclic and missing dependencies are rejected.
- No existing CLI script is removed or modified.
