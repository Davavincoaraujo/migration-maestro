# Migration Maestro in Maestri.app

Maestri.app is the operator interface. This repository supplies the local migration engine, model routing, durable request records, and role instructions. Do not create another dashboard, orchestrator, or Next.js application.

## One-time Maestri setup

1. Open the existing Migration Team workspace with this repository.
2. Use **Discover Roles** to import `.maestri/maestro/role.json` and the four specialist roles in `.maestri/roles/`.
3. Assign Maestro to the Migration Orchestrator terminal. Assign Analytics, UE-Pattern, Hermes, and Validator roles to matching available agent terminals.
4. Use supported Codex/Claude presets when creating terminals. Existing terminal model selection is not changed by this repository.
5. Confirm visibility with `maestri list` from a terminal with Maestro enabled and inspect visible model footers with `npm run model-router:inspect`.

Maestri role files are versioned configuration. They do not create terminals, authenticate providers, or change a running session's model. A terminal with Maestro mode enabled is required for the documented Maestri CLI communication commands.

## Natural-language requests

The coordinator role recognizes a public URL migration request and “Corrija a última migração”. It should persist/resolve the intent with:

```bash
npm run autopilot:intake -- "Migre esta URL: https://example.com/page"
npm run autopilot:intake -- "Corrija a última migração"
```

The intake command validates and persists the request, then invokes the existing central controller with the local portal/AEM workflow. Existing completed migrations are recovered without repeating writes. Execution requires reachable authorized Maestri sessions, local AEM environment authentication and portal access. A blocked request is persisted for recovery and must never be reported as an executed migration. See docs/local-execution.md for current gates and limitations.

## Routing and execution boundaries

- Run `npm run model-router:inspect` before model work. Route deterministic file checks, tests, builds, HTTP checks, and parsing without an AI call.
- The router selects only visible, available, authorized Maestri sessions. It prefers the configured specialist for the stage, then uses a compatible active session. A fallback is recorded. CLI model catalogs are not proof of account entitlement.
- ECONOMY, BALANCED, and ADVANCED are target profiles. Never fabricate a model, price, token count, or active session. Do not change a live session's model.
- Analytics inventories the public source; UE-Pattern maps it to real portal components; Hermes implements in the existing authorized `portalbradesco` checkout; Validator independently checks results; the coordinator handles the local AEM Author integration.
- Before AEM writes, verify the target is absent. Use create-only page and DAM operations. Never overwrite an existing page or asset. Use only existing local authentication and never print secrets.
- Preserve project changes and branches. Use the existing `portalbradesco` project and its current Next.js server; do not start a duplicate server or create a second project.
- Retry only bounded transient failures. Infrastructure failures do not trigger model escalation. Resume from the durable checkpoint and do not repeat a confirmed AEM create/upload.
- Tests, builds, local HTTP and browser verification must have captured output before they are reported as passed. Human review remains required for visual gaps or uncertain media behavior.
- No remote push, merge, publication, credential changes, destructive overwrite, or work outside explicitly configured local directories.

## Current capability facts

`npm run autopilot:central` is the checkpointed synthetic Maestri demonstration, not the `portalbradesco` production executor. `autopilot:intake` now invokes the local workflow extension; its real end-to-end acceptance remains blocked by host permissions/authentication. Do not report an unexecuted stage as completed. The default central demo remains synthetic.

See `docs/maestri-primary-interface.md` for activation and current limitations.
