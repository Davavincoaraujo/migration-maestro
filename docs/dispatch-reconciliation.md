# Dispatch and fallback reconciliation

Routing chooses an authorized compatible session before dispatch. The controller
persists the selected route, then a task receipt with UUID, agent identity and
SHA-256 of that route, before calling official `maestri ask` once.

After a timeout, restart or provider fallback selection, recovery is check-only:

1. Load the original receipt and route. Verify agent identity and route digest.
2. Read an existing result for exactly that task ID and stage. A late result is
   usable even when the original polling budget has already been exhausted.
3. If polling remains, use `maestri check` against the original routed agent.
4. Validate the stage's artifacts before adding a completed checkpoint.

The preferred session returning, a provider limit or the lack of a result is not
proof that the original task stopped. None authorizes a second `ask`, a new task
ID or switching providers after dispatch. The per-stage reconciliation report
records the pinned agent, provider, model, requested/actual profile, route digest,
digest-integrity class, and `check-only`, `await-late-result` or
`result-collected`. It explicitly records `routePinned:true`,
`providerSwitchAuthorized:false`, and `resendAuthorized:false`. Collected results
still require stage validation. Legacy receipts without route digests are marked
`legacy-route-only`; they are not misrepresented as receipt-digest-verified.

Missing/corrupt routes, identity changes or receipt loss fail closed. Prior route
selection or a `dispatch-intent` event prevents treating a lost receipt as a new
task. Legacy receipts without route digests may recover only with their saved
route; receipt and result IDs remain unchanged. Completed legacy checkpoints are
preserved. An ambiguous task requires explicit operator reconciliation; this
implementation intentionally offers no automatic cancellation or redispatch.

Regression tests use deterministic fake transports and a CLI subprocess fixture.
They establish controller behavior, not live provider cancellation or delivery
semantics. Real acceptance remains gated by authorized Maestri access.

## Authorized execution boundary

New tasks also persist `<STAGE>.dispatch.json`, containing the exact prompt,
job/task/stage, selected agent and route digest. Its SHA-256 is bound into the task
receipt. `DispatchExecutor` separates dispatch from the controller's discovery
and polling transport. `executeMigrationRequest` forwards this executor option.
Existing integrations using `transport` keep the official CLI adapter by default.

The executor exclusively creates `.dispatch-attempt.json` **before** invoking
`ask`. Competing executors, restarts and ambiguous timeouts cannot claim that
request again. The attempt records executor identity and optional terminal and
session IDs. The CLI adapter reads the existing `MAESTRI_TERMINAL_ID`; it never
sets or substitutes it. No target session ID is invented from an agent name or
model footer. A custom authorized executor can supply its own session identity.

`.dispatch-receipt.json` binds to the attempt digest and distinguishes
`command-returned` from `unknown`. Neither proves delivery: `deliveryVerified`
is always false for this CLI boundary. A missing outcome receipt after a crash
leaves the attempt authoritative for preventing resend; a matching late result
may still be validated. Digests detect inconsistent local evidence; they are not
signatures or proof of provider execution. The job directory and executor require
normal filesystem authorization.

To queue the next specialist task without sending it:

```sh
npm run autopilot:central -- <job-id> --defer-dispatch
```

The controller stops with `AUTHORIZED_EXECUTOR_REQUIRED` recorded in its event
log. Discovery/preparation still require their normal authorized transports.
Inspect the persisted request, then in the authorized Maestro terminal run:

```sh
npm run autopilot:dispatch -- .local-maestro/central-demo/<job-id> ANALYZE
npm run autopilot:central -- <job-id> --defer-dispatch
```

Resume uses the same task ID and checks artifacts; it does not send the pending
task. Repeat explicit execution for each newly queued specialist stage. Do not
remove an existing attempt to retry an ambiguous send. A crash before a complete
request is persisted requires operator reconciliation and never automatic resend.
Controller/request locks still fail closed after a process crash, as documented
in `central-autopilot.md`; this change does not steal locks.

New completed stage outputs retain their dispatch binding. Reuse verifies the
request, task/route binding, attempt and any outcome receipt alongside the result
and artifacts. Historical checkpoints/receipts are not rewritten or retroactively
presented as having executor evidence. Their existing validation remains intact.

## Versioned result and ANALYZE pause

New requests additionally bind `resultContractVersion:2` into the request digest
and task receipt. A new result requires `version:2`, the matching job/task/stage
and a nonempty relative artifact manifest with SHA-256 digests. Missing files,
changed bytes, invalid hashes and directory escapes block checkpoint completion.
Verified hashes are retained in the checkpoint output and rechecked on reuse;
workflow artifacts are merged without dropping the result manifest. Legacy
requests without this marker keep their original result contract and are never
retroactively attested as v2.

`autopilot:central` now accepts `--pause-after-analyze` alongside
`--defer-dispatch`. The pause occurs after the ANALYZE checkpoint is durable and
before MAP_COMPONENTS preparation, including the catalog call. Repeat both flags
on reconciliation to keep that boundary. The full pipeline is retained and the
checkpoint stays `running`; operational status is `paused`. See the
[complete authorized Analytics procedure](analytics-authorized-validation.md)
for exact commands, request checks, dispatch, late-result recovery and acceptance.
