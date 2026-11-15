# Local portal workspace is the implementation target

The Maestri desktop application is the primary operator UI. Maestro Core coordinates the Migration Analytics MCP and a local construction agent.

## Local-only implementation target

- Workspace path (on the operator's Mac): `~/Developer/iibr-fed-portalbradesco`.
- The construction agent must operate on this local checkout, not on GitHub or Azure DevOps.
- The `migration-maestro` repository is only the orchestrator's own development project; it is not the target for generated portal code.
- Do not upload portal source, content, credentials, evidence or diffs to the orchestrator repository or external services.
- The portal workspace must be configured explicitly on the operator's machine; never assume this directory is available in CI or remotely.

## Required execution controls

1. Confirm the workspace exists, is a Git worktree and resolves to the expected local directory. Reject traversal, symlinks escaping the workspace and mismatched roots.
2. Inspect working-tree changes before starting. Never reset or overwrite existing user modifications.
3. Start analysis with the Migration Analytics MCP (read-only by default); produce structured requirements and evidence references without raw private content.
4. Generate an execution plan; obtain explicit human approval before changing files or running privileged tools.
5. Construct changes in an isolated local worktree or dedicated branch, preserving the source checkout.
6. Run local checks, report test results and return a local diff for review. Do not push, open PRs, publish or deploy automatically.
7. Keep audit snapshots local, with sensitive values excluded.

## Status

This document establishes the integration contract only. The local portal checkout is not accessible from the GitHub connector; no edits to the portal have been made. MCP discovery and local construction agent wiring remain to be implemented and tested on the operator's Mac.
