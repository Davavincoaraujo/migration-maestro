# Synthetic PageCompositionPlan and Jira handoff

This stage turns approved-format structural mapping proposals into a page composition shortlist, preserving source order. It requires exactly one candidate per source section and blocks ambiguous or missing targets.

The Jira handoff is a **local JSON/Markdown artifact**, not a live Jira API integration. It deliberately excludes page text, URLs, source paths and business content.

The composition is structural only. It does not create real AEM nodes, author `model.json`, validate actual component props, compare screenshots, or publish. A plan with status `review-required` is not authorization to write.
