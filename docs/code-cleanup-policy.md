# Code cleanup policy — Maestro Core

The repository is transitioning from a migration-specific prototype into a provider-independent orchestrator. Deletion is allowed only after dependency and behavior verification.

## Retain
- `src/core/**` and core tests.
- Reusable workflow execution, MCP, model routing, isolation, approvals, audit and evidence implementations, until moved to the new core.
- Legacy migration workflows and CLIs while compatibility is maintained.

## Removal gates
1. Run `node scripts/audit-dead-code.mjs > local-output/dead-code-audit.json` (create local-output first).
2. Confirm no package script, import, dynamic reference, test, documentation link, or external CLI consumer uses the candidate.
3. Migrate any reusable capability first; remove the old entrypoint only when the replacement is covered by tests.
4. Delete corresponding obsolete tests and docs in the same PR, never independently of their feature.
5. Run `npm run check && npm test` and inspect the PR diff before merging.

The audit intentionally only produces **candidates**. It does not delete files. A static import scan is insufficient evidence of safe removal. Corporate project data and local evidence must never be committed.
