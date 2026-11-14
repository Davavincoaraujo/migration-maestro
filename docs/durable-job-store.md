# Durable Autopilot jobs (stage 9)

`FileJobStore` implements the existing `JobStore` interface with JSON records on local disk. It writes to a unique temporary file and renames it into place to avoid partially written JSON. Files are created with owner-only permissions where supported. The directory is not automatically synced or committed.

**Important limitations:** this is a **single-process** storage adapter, not a database. It does not provide cross-process locking, transactional audit trails, encryption at rest or distributed scheduling. Only use with synthetic examples or in an approved enterprise-controlled environment. The records may include source page content, so do not upload the job directory to a personal repository.

An interrupted job can be read back. The current Autopilot retries a non-review job from the beginning; it does **not** resume at an exact interrupted stage. This is safe only while stages remain read-only and idempotent. Before any AEM writes, add explicit idempotency keys, durable stage checkpoints and transactional ownership/leases.
