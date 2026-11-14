# Checkpointed synthetic batch orchestrator

`runSyntheticBatch` integrates the bounded queue, per-job stage checkpoints, structural mapping, page composition, ue-pattern simulation and Jira handoff. Each synthetic job gets a deterministic 20-character digest ID. A completed job remains in `awaiting-review` on rerun, while an interrupted stage can be retried without repeating completed stages.

**Restrictions:** this is an in-process prototype, not a durable distributed service. Persistence depends on the supplied `CheckpointStore`; the current `MemoryCheckpointStore` is lost on restart. There are no leases, locking, database migrations, provider budgets, browser analysis or real MCP/AEM/Jira calls. The batch is safe only for idempotent, non-writing stages. Human approval is still mandatory.
