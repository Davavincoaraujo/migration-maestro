# Central Autopilot: isolated demo and public pilot

The Migration Orchestrator owns dispatch, polling, validation and persistence. Specialists never need to initiate a message back. The default executable path accepts a fixed synthetic hero fixture. A workflow extension also supports the fixed public-page pilot described in [public-pilot.md](public-pilot.md). Neither path is a production migration executor.

## Architecture

`central-controller.ts` reuses `runCheckpointed` and `FileCheckpointStore` for sequential execution and atomic durable outputs. The existing dispatch preview, ACP planner, approval records and worktree executors retain their separate contracts: preview is not execution authorization, and ACP connectivity is not canvas delegation.

`CentralWorkflow` supplies stage preparation, specialist instructions and artifact validation. Artifact hashes (including binary screenshots) are rechecked on resume and before each next stage. The public pilot reuses the same dispatch receipts, retry budget, lock and REVIEW gate instead of implementing a second controller.

`maestri-central-cli.ts` invokes the installed official CLI using argument arrays and no shell: `list`, `ask <agent> <prompt>`, `check <agent>`. It neither assumes `MAESTRI_SOCKET` nor uses raw terminal input. The older `maestri:run` bridge is unchanged; use `autopilot:central` for this workflow.

| State | Owner | Gate |
| --- | --- | --- |
| ANALYZE | Analytics | New tasks: result v2 bound to job/task/stage and SHA-256 artifact manifest |
| MAP_COMPONENTS | UE-Pattern + central Analyst MCP call | Nonempty real catalog search and structured demo mapping/gaps |
| PLAN | Hermes | Structured plan and evidence |
| IMPLEMENT | Hermes | Structured result plus static HTML contract checks |
| VALIDATE | Analytics + controller | Independent assessment, repeated static checks and unchanged implementation hash |
| REVIEW | Human | Terminal awaiting-review state; no publication or merge authorized |

Before advancing or resuming, the controller verifies previous result hashes. The catalog is queried without reordering its results. Raw catalog content stays in a local ignored evidence file and is not sent to agents. Mapping therefore documents a generic synthetic composition and gaps, not verified reuse of corporate code.

New specialist requests persist `resultContractVersion:2` in both the dispatch request and task receipt. Results must declare `version:2`, the exact `jobId`, `taskId`, `stage`, and a nonempty `artifacts:[{file,digest}]` manifest. The controller checks each relative file's containment, regular-file status, 5 MB limit and SHA-256 before checkpointing, persists the verified hashes, and checks them again on resume. Legacy requests and completed checkpoints retain their original validation and are not retroactively marked v2.

For the first authorized Analytics cycle, follow [the complete isolated validation procedure](analytics-authorized-validation.md). `--pause-after-analyze` pauses after saving the ANALYZE checkpoint and before MAP_COMPONENTS preparation, catalog access, routing or dispatch. Use it together with `--defer-dispatch` on every preparation/reconciliation command. The checkpoint remains `state:"running"`, while `status.json` reports `status:"paused"` and the CLI returns `paused:true`. The full pipeline and input digest stay unchanged. Omitting the pause flag allows continuation; requesting it after later stages have completed is rejected.

## Run and resume

From the project directory, load the local integration environment and use a stable 20-character hexadecimal migration ID:

```sh
source .local-maestro/integration-env.sh
npm run autopilot:central -- 20261116000000000005 --defer-dispatch --pause-after-analyze
```

Confirm that the example job does not already exist before its first creation; never reuse the historical jobs ending in 0001–0004. Use the same command to reconcile the prepared request after its explicit authorized dispatch. Preparation intentionally exits with a checkpointed ANALYZE failure and records `AUTHORIZED_EXECUTOR_REQUIRED`; no prompt is sent. Maestri must have active Analytics, UE-Pattern and Hermes sessions connected. If socket/IPC access is denied, use the original authorized Maestro shell; do not change permissions or disable agent sandboxing. Specialists write their results through their normal filesystem tools in the authorized demo directory.

Artifacts live under `.local-maestro/central-demo/<id>/`: checkpoint, task receipts, result JSON, catalog evidence, HTML, terminal logs, status, failure history and event log. They are intentionally ignored by Git. `status.json` reports the current uppercase stage; the shared checkpoint format uses lowercase hyphenated IDs. Completion is `awaiting-review`, not approval to publish.

## Failure and recovery rules

- Each command has a 30-second timeout and 128 KB combined output bound. Diagnostics avoid copying stderr into public output.
- A durable dispatch intent is written before `ask`. There is at most one automatic send per stage, even if its outcome is unknown after a crash or timeout.
- After an ambiguous send, only `check` and artifact reads are retried: by default up to 12 checks, spaced five seconds apart. The consumed budget survives restart. Rejected/malformed results block successors.
- A late valid artifact can be accepted on resume after the polling budget is exhausted. If no result arrives, an operator must inspect the specialist before any manual redispatch; creating a new migration ID is not automatic recovery.
- A controller-directory lock serializes jobs sharing these specialists. A process crash leaves the lock in place and fails closed. An operator must verify that no controller or delegated task is still running before reconciling a stale lock. There is no automatic lock stealing or cancellation of a remote specialist.
- Hash mismatch blocks reuse. Human corrections require investigation and a new reviewed run; the controller never silently accepts changed evidence.
- REVIEW has no transition to publication or merge. Those capabilities are deliberately absent; an external human approval process would be required before adding them. Agent text cannot grant that approval.

## Limits

Structured stage evidence is schema checked, not a proof that every natural-language assertion is true. HTML checks cover fixture strings, semantic elements, an internal CTA target, responsive CSS and several disallowed active/external constructs. They are not a complete HTML sanitizer, browser rendering test, accessibility audit or security sandbox. Specialist tool permissions remain the enforcement boundary. The demo never executes agent-generated scripts or installs generated dependencies.

This workflow requires shared local filesystem access. There is no remote artifact transfer, authenticated reviewer service, distributed lease, general URL intake, production destination, or automatic Git operation. The existing production-facing adapters are not called.

The controller persists sanitized status and checkpoints for headless resumption. Maestri.app is the operator interface; this repository does not expose a competing HTTP dashboard.

## PLAN pause and readiness

`--pause-after-plan` uses the same durable boundary as existing pause flags and
returns before IMPLEMENT preparation, routing or receipt creation. See
[PLAN v1 acceptance](plan-authorized-validation.md) and
[autonomy readiness](autonomy-readiness.md) for contract scope, CLI commands and
remaining live integration gates.
