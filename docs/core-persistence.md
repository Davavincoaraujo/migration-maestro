# Durable Maestro Core run snapshots

`FileRunStore` writes local-only JSON snapshots with atomic rename and restrictive file permissions. A new instance can reload a previous run.

`recoverInterruptedRun` converts in-flight tasks to `review_required`, retaining attempt counts. It does **not** rerun any agent or tool. An operator must inspect evidence and decide how to proceed.

Limitations: single writer per run; no optimistic concurrency, event journal, queue, process locking, or automated replay yet. Never store raw corporate evidence or secrets in run metadata. Existing migration-specific stores remain unchanged during the transition.
