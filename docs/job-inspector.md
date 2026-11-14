# Job inspector and dashboard refresh

Start the existing local dashboard:

```sh
npm run check
npm test
npm run dashboard -- .local-maestro/ui-demo
```

Open http://127.0.0.1:4177. The jobs table now has a **Detalhes** link for each job, showing completed pipeline stages, findings, status, component count, and any recorded human decision. Both pages refresh every 10 seconds and re-read the local report and ledger. No browser-side scripts or external network requests.

**Important:** this is *polling of existing report files*, not a streaming execution engine. A new run must still be initiated through the CLI, and the report must be regenerated to display its results. Automatic page refresh may reset text being entered into the reviewer field; submit promptly or pause refresh through browser controls if needed. The report remains synthetic, read-only and loopback-only. No AEM writes, publication or corporate access.
