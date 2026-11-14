# Evidence-gated synthetic migration

`runEvidenceGatedPipeline` joins the sanitized legacy evidence contract with the existing synthetic structural migration pipeline. Evidence must reference the same page ID. Broken links or an unmapped section block the overall result, while a passing result remains `review-required` and never publishable.

This is an offline integration using synthetic data, **not** browser capture, a real accessibility audit, a live Lighthouse run or an AEM publishing gate. It does not automatically update the checkpointed batch runner. Those integrations require separate work.
