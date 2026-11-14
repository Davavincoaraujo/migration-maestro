# Local synthetic workbench — five capabilities

Run locally (requires the repository's existing `tsx` devDependency):

```sh
npm run check
npm test
npm run workbench -- examples/workbench-jobs.json
```

Open `.local-maestro/workbench/index.html` in a browser. The same directory contains `report.json` and persistent checkpoint files. This does not require GitHub Actions, a corporate repository, an external AI model or network access.

1. **Autopilot:** bounded queue and resumable, local checkpointed synthetic jobs.
2. **MCP boundary:** `createWorkbenchReadTools(report)` exposes four existing allowlisted read operations through the in-process dispatcher. **Not a standards-compliant network MCP server.**
3. **Migration intelligence:** structural component matching and sanitized SEO/link quality gates; not a semantic AI mapping engine.
4. **Observability:** consolidated job counts and completed checkpoint stage counts; model cost is zero because no model is invoked. No token accounting or stage duration measurement in this workflow.
5. **Interface:** generated static HTML dashboard with escaped content, no network, and no edit/approval buttons. A future interactive UI needs a secure backend and persisted review decisions.

**Security:** synthetic input only in personal GitHub. Local checkpoint files may contain intermediate source data; do not commit real corporate inputs or generated reports. No AEM writes, Jira writes, model provider calls or publishing. Review-required is not approval. Checkpoint storage is single-process and not safe for multiple workers sharing one directory.
