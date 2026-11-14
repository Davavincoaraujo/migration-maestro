# Legacy mapping planner (stage 6)

This first mapping planner accepts **synthetic or approved structural summaries** of legacy components. Each source has an opaque ID, number of nested collections and maximum nesting depth. It compares those properties with the anonymized component catalog.

The planner intentionally only suggests **exact structural matches**. A score of 100 means two measured structural properties matched; it is **not** 100% confidence that a legacy component is compatible with the proposed target. All suggestions are `review-required`; no-match is explicit.

This is an early matching heuristic, not a content transformation engine. It cannot identify business rules, fields, images, analytics, accessibility requirements, SEO, component semantics, JCR node layouts or true AEM `sling:resourceType`. No code writes or publishes AEM content.

Next: define an enterprise-local approved mapping contract with component semantics and source-to-target field transforms; build dry-run fixtures; then add validation and PR-based approval before any AEM write capability.
