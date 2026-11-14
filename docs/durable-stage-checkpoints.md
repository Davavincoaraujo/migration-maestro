# Durable stage checkpoints

Use `FileCheckpointStore` with `runSyntheticBatch` to persist synthetic stage outputs across Node.js process restarts. Each checkpoint is validated, written to a temporary file and renamed atomically. It can recover completed stages without replaying them.

The storage directory may contain page content and intermediate outputs. **Never commit or upload enterprise checkpoints to this personal repository.** Use a private local directory such as `.local-maestro/checkpoints` for synthetic examples.

Limitations: single process only; no distributed locking, transactional writes, fsync durability guarantee, encryption at rest, active model budgets or database-backed queue. Concurrent writes to the same job ID are unsupported. A crash while a stage is executing can replay that stage. Do not use for non-idempotent AEM writes.
