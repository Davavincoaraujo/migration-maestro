# Hermes — Maestri-first local feature orchestrator

Hermes is the Maestri coordinating role for a local portal migration demand. The Migration Analytics MCP should supply requirements and evidence; Hermes converts them to a JSON manifest, then uses the pure planner to create a task DAG and local feature-branch names. The construction agent executes approved tasks in isolated local Git worktrees; the reviewer checks each result.

## Commands

`npm run hermes -- examples/hermes-demand.example.json` — plan only, no local portal access.

`npm run hermes -- examples/hermes-demand.example.json ~/Developer/iibr-fed-portalbradesco` — validate the local portal checkout and preview worktree paths, without modifying it.

`npm run hermes -- examples/hermes-demand.example.json ~/Developer/iibr-fed-portalbradesco --approve-worktrees` — **explicitly create** local feature branches and worktrees. Requires a clean portal checkout and refuses existing branches or worktree paths. No push, PR, merge, deploy, or remote access.

Feature dependencies are expressed in the task DAG, but Git branches currently start from the same local HEAD. Integrating dependent features requires explicit review; no automatic merges are performed.

## Current boundaries

The Maestri role is a prompt/configuration, not a continuously running autonomous daemon. This phase adds deterministic task/branch planning and optional local worktree preparation. It does **not** yet implement the real Migration Analytics MCP handshake, a task queue, automated code edits, or Maestri-to-Core machine-readable event ingestion. These require integration and tests on the operator's Mac. Never put corporate content or secrets in example manifests or remote repositories.
