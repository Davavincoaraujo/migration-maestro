# Evidence-aware checkpointed batch

`runEvidenceBatch` combines sanitized evidence analysis, structural composition and a quality gate as three checkpointed stages, executed with bounded concurrency. A distinct job-ID namespace avoids collisions with the earlier structural-only batch.

The checkpoint runner's `awaiting-review` state means **pipeline stages completed**, not that quality checks passed. Inspect `outputs["quality-gate"].status`: `blocked` requires remediation; `review-required` still requires human approval. Neither permits publication.

This is offline synthetic processing. No real browser capture, external services, corporate source content, model API or AEM write.
