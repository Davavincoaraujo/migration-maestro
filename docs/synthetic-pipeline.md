# Synthetic end-to-end structural pipeline

`runSyntheticPipeline` connects the existing structural mapping planner, page composer, ue-pattern simulator, and Jira handoff generator. It accepts a synthetic page ID, synthetic section topology, and sanitized component catalog. The result includes mapping candidates, PageCompositionPlan, simulation status and a Jira-ready local object.

This is **not** the intended real end-to-end demonstration yet: it does not ingest a URL, capture screenshots, analyze DOM/SEO, call a real MCP server, execute a model, persist checkpoints, or interact with AEM/Jira. Every output requires human review and is marked as non-writing.

To avoid proprietary data leakage, use only synthetic inputs in this personal GitHub repository.
