# Local workbench — telemetry and review decisions

Run `npm run check && npm test`. For deterministic local fixtures, generate a headless JSON report:

```sh
npm run workbench:run -- examples/workbench-jobs.json
npm run review -- digest demo
npm run review -- approve demo reviewer_1 <paste-the-digest>
npm run review -- list
```

Use the printed digest as the final argument; do not include angle brackets. `reject` is also supported. The review command writes `.local-maestro/workbench/reviews.json` with a digest-bound decision. Only a review-required job with no findings is eligible. A decision is immutable in this single-process local prototype and does **not** publish or grant AEM write access. Maestri.app remains the operator interface; this fixture runner is not the production migration path.

The report now distinguishes **completed stages** (cumulative checkpoint contents) from **stage executions in this invocation**, **reused fully completed checkpoints**, and **elapsed wall-clock milliseconds**. Model cost remains zero because no provider calls occur. Stage executions for failed tasks may be undercounted, because the bounded queue does not expose partial checkpoint state.

Security and limits: synthetic data only in local testing. Review ledger is single-process atomic-file storage, not a distributed transaction, identity proof or cryptographically signed approval. Concurrent reviewers and a production enterprise approval policy require a transactional store, authentication, authorization and audit logging. No network MCP server or AEM writes.
