# Maestri.app as the Migration Maestro interface

Maestri is the intended user-facing workspace. This repository contains importable role instructions and local command-line tooling; it does not access or modify Maestri's private application state.

## Activate the versioned roles

1. Open the existing Migration Team workspace rooted at this repository.
2. In Maestri **Settings → Agents → Discover Roles**, import `.maestri/maestro/role.json` and `.maestri/roles/{analytics,ue-pattern,hermes,validator}/role.json`.
3. Assign the coordinator role to the Migration Orchestrator terminal and the four specialist roles to their corresponding active terminals.
4. Ensure the coordinator terminal has Maestro mode enabled. Run `maestri list`; it must show the connected specialists.
5. Run `npm run model-router:inspect` in that terminal to record actual visible provider/model sessions and route decisions.

The role sidecars persist in Git, but their import and terminal assignments are Maestri account/workspace state and are not activated by editing this repository. Creating a terminal from a preset uses the installed Maestri UI/CLI capability; this repo cannot authenticate an account or switch a running terminal model.

## Natural-language entry

The coordinator role handles a URL request or “Corrija a última migração” and uses the deterministic intake/checkpoint command:

```bash
npm run autopilot:intake -- "Migre esta URL: https://example.com/page"
npm run autopilot:intake -- "Corrija a última migração"
```

This validates/persists the request and invokes the local workflow extension of the existing controller. Completed requests are recovered without repeating writes. The workflow uses connected specialists and configured local tools; invocation alone does not prove successful execution. If Maestri mode, a specialist session, model tier, or local auth is unavailable, preserve the checkpoint and report the precise blocker.

## Actual destination and safeguards

- Code: the existing configured target-application checkout and existing Next.js instance.
- Content: the confirmed local AEM Author only.
- AEM page/DAM operations: preflight destination absence, then create-only; never overwrite.
- No duplicate Next.js project or server, no dashboard, no remote publication, push, merge, or credential changes.
- Every stage reported as complete must have concrete stored command/browser/AEM evidence.

## Current integration boundary

The central Autopilot CLI is a synthetic workflow demonstration. The natural-language registry now invokes the local portal/AEM workflow extension. Live acceptance remains blocked by host permissions and authentication; see docs/local-execution.md. This distinction is documented in `MAESTRI.md` and the coordinator prompt so future sessions cannot mistake a queued request for completed work.

Maestri documents:
- https://www.themaestri.app/en/docs/maestro
- https://www.themaestri.app/pt-br/docs/terminals
