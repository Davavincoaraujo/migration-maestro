# Run synthetic migration batches from the dashboard

The local dashboard now has an **opt-in** button to execute an explicitly configured synthetic JSON fixture. No arbitrary paths are accepted from the browser and no shell command is executed.

```sh
npm run check
npm test
npm run workbench -- examples/workbench-jobs.json .local-maestro/ui-run
npm run dashboard -- .local-maestro/ui-run 4177 examples/workbench-jobs.json
```

Open http://127.0.0.1:4177 and click **Executar lote sintético**. The server runs the existing evidence pipeline with bounded concurrency and durable checkpoints, writes the local report, and redirects to the updated dashboard. Click **Detalhes** for completed stages and findings. Running the same fixture again should reuse its checkpoints (0 new completed stages).

Without the optional third argument, the dashboard remains **review-only** and does not expose the run button. Browser input cannot specify a file or output directory. Only use synthetic files in a personal repository. The server binds to 127.0.0.1 and validates the CSRF token, origin and content type.

**Limitations:** this is a synchronous local HTTP run, not streaming progress; browser waits for the batch to finish. The 10-second refresh is file polling. This is not an enterprise AEM integration, AI orchestration, authentication, or authorization to publish. Do not run multiple instances writing to the same directory. Do not change job content under the same ID after recording review decisions; create a fresh output directory for a new dataset until versioned review-ledger reconciliation is implemented.
