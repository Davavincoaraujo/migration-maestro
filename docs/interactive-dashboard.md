# Interactive review dashboard (local only)

Run with the existing dependencies:

```sh
git pull origin main
npm run check
npm test
npm run workbench -- examples/workbench-jobs.json .local-maestro/ui-demo
npm run dashboard -- .local-maestro/ui-demo
```

Open **http://127.0.0.1:4177** on the same computer. A fresh output directory is recommended because the previous `demo` job was already approved in `.local-maestro/workbench/reviews.json`. Only eligible pending jobs show approval/rejection forms. Enter a local reviewer ID, then click a decision. The dashboard records the decision and displays it in the history.

This server uses Node built-ins only, binds exclusively to 127.0.0.1, validates Host and Origin on POST, uses an unpredictable session CSRF token, enforces a small body limit, escapes rendered HTML, and never exposes write/publish operations. No authentication or multi-user access is provided; **do not forward this port, run behind a proxy, or expose it to other devices**. Review decisions are synthetic local records, not corporate authorization.

Limitations: the file ledger supports a single process and is not transactional across processes; do not run this server alongside another writer using the same ledger. The UI is server-rendered HTML forms, not React. No network MCP transport, corporate data, AEM writes or AI provider calls. Existing `index.html` remains a static read-only report.
