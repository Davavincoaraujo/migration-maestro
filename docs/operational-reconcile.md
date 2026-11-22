# Offline operational reconciliation

Run `npm run maestro:operate -- reconcile <job-id> --dry-run` to inspect an
existing operational job. `--dry-run` is mandatory; there is no write mode.
The JSON report goes to stdout. No Maestri command, workflow, task creation,
proof creation, checkpoint update, lock acquisition, or pipeline advance occurs.

The inspector reuses capability, policy, dispatch provenance, stage result,
artifact digest, mapping/plan contract and checkpoint format validators. Existing
proofs and checkpoint artifact bindings are checked where present. Legacy stage
receipts remain readable and explicitly lack executor attestation. Workflow
specific acceptance is not performed; this report cannot complete a stage.

`local-evidence-valid` means the inspected local results passed their applicable
contracts. It does not authenticate delivery or authorship, authorize resend,
or remove the persisted blocked status. Missing results are pending; incomplete
or corrupt dispatch evidence is invalid. An absent probe proof is reported but
never created. `unknown` transport outcomes remain `unknown`.

The command preserves the stored planning ceiling. It compares file digests and
metadata before and after inspection, rejects symlinks, and reports concurrent
changes as invalid. This is an offline observation, not a transactional snapshot
or permission to resume. Run with the controller idle. Invalid reports exit 1;
valid or pending inspections exit 0. Malformed job-level records fail closed.

A future resume requires explicit authorization for new dispatches, authorized
Maestri connectivity, unchanged valid evidence, and retention of `planOnly:true`
when persisted. Reusing an existing probe does not resend it, but a normal resume
may immediately dispatch the next task. Never delete receipts to enable retries.
