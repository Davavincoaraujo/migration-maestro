# Migration Maestro + Nous Research Hermes Agent

The product remains named **Migration Maestro**. **Hermes Agent** means the external open-source Nous Research agent harness, not a newly invented agent runtime. The Maestri desktop application remains the operator UI.

## Responsibility boundaries

- Maestri: human-facing agent terminals, collaboration and approvals.
- Migration Maestro: task DAG, feature branches, local worktrees, run records and policy gates.
- Nous Research Hermes Agent: external AI harness for reasoning, extraction and coding, once a supported invocation contract is configured.
- Migration Analytics MCP: domain analysis and specifications; actual MCP transport and tool schema must be discovered from the user's installed MCP.
- Local portal checkout: exclusive target for generated code, never pushed or mirrored automatically.

The existing `.maestri/hermes/role.json` describes a **coordinator role**, not the Nous Hermes executable. It must not be mistaken for installing or launching Hermes Agent.

## Bridge status

`NousHermesAdapter` supports a bounded, shell-free **availability probe** for a user-configured local executable. Its `execute` deliberately returns `review_required` and `HERMES_EXECUTION_PROTOCOL_NOT_CONFIGURED` rather than guessing command-line flags or fabricating agent results.

Before enabling coding, validate the installed Hermes version, supported invocation protocol, workspace sandboxing, permission model and structured output format. Implement explicit human approval and a durable, pre-execution checkpoint. Do not forward private portal files to unapproved providers.

## Local test

Run `npm run check && npm test` after pulling. Open the portal checkout separately in Maestri. No real Hermes execution or MCP analysis is claimed by these tests.
