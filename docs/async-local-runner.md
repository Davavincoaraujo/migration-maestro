# Asynchronous local synthetic runner

The dashboard starts the synthetic batch in the background and immediately redirects to the dashboard. It does not hold the browser request open while the pipeline runs. The dashboard refreshes every 10 seconds and displays whether the most recent run is active, completed, or failed.

The read-only `GET /run-status` endpoint returns a small JSON state object: `idle`, `running`, `completed`, or `failed`, with start/end timestamps where applicable. It never returns raw evidence, corporate content or exception messages.

```sh
npm run check
npm test
npm run workbench -- examples/workbench-jobs.json .local-maestro/async-demo
npm run dashboard -- .local-maestro/async-demo 4177 examples/workbench-jobs.json
```

Open http://127.0.0.1:4177 and click **Executar lote sintético**. A second run is rejected while a run is active. A failed run leaves the previous report untouched; a successful run atomically replaces `report.json`. Existing checkpoints are reused.

**Current limitations:** status is in server memory and resets on restart; it is not a durable task queue. This milestone reports batch-level status only, not each stage in real time. A process interruption may leave an unfinished run, but checkpointed stages can be resumed by starting a new run. No AEM writes, remote integrations, auto-approval, or production publishing are enabled. Use only synthetic fixtures.
