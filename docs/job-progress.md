# Per-job progress (synthetic local execution)

The opt-in local dashboard now exposes per-job progress while a batch runs. The `GET /run-status` endpoint returns the batch state and a `jobs` array containing sanitized job ID, state, last completed stage, completed count, and total count. The dashboard displays a progress table and refreshes every 10 seconds.

The progress callbacks are emitted **after a stage checkpoint has been persisted**, so counts reflect durable completed work. Previously completed jobs report `checkpoint-reused` during a rerun. The final statuses are `review-required`, `blocked`, `failed` or `cancelled`, matching the workbench report.

This is local in-memory progress, not a durable event bus or live WebSocket feed. Jobs queued but not yet executing show `queued`. A failed batch before a report is produced may retain intermediate states; the batch-level `failed` state is authoritative. No source content or model output is exposed by this endpoint. No AEM writes, remote tools, auto-approval or publishing.
