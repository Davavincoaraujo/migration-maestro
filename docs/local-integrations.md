# Local integration preflight

Run `npm run integration:doctor` on the Mac hosting Maestri and Hermes.

The diagnostic checks the macOS Maestri application bundle and probes `hermes --version` without a shell. A successful version probe establishes only that a CLI responds; it does **not** establish that an agent session, model credentials, Maestri workspace bridge, MCP, or autonomous execution is configured.

The report deliberately returns `agentsConnected: false`, `executionConfigured: false`, and `readyForAutonomousExecution: false` until supported protocols are implemented and tested.

Next evidence needed locally:
- Maestri: documented integration mechanism (if any), not inferred from application internals.
- Hermes: supported non-interactive invocation and session protocol, with authorization and isolation.
- Migration Analytics MCP and construction agent: explicit local endpoint/configuration and allowed capabilities.

Never upload private app state, corporate source, credentials, or portal code to this repository. The portal stays in its local checkout. No automatic push, merge, deploy, or approval bypass.
