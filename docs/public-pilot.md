# Public-page migration pilot

The pilot extends the existing central controller with `publicPilotWorkflow`; it does not bypass the stage gates or specialist sandbox. Its only source is the public loans/financing landing page from a legacy client-specific pilot, with a fixed URL allowlist in code (not a generic integration). No production destination exists.

```sh
source .local-maestro/integration-env.sh
npm run autopilot:pilot -- 20261115000000000002
```

Resume with the same ID and flags. A changed input profile is rejected. Do not create a new ID to retry an ambiguous running specialist. A browser/CLI execution outside the sandbox requires approval through the host; no code disables sandboxing or changes socket permissions.

## Data boundaries

The default profile uses public data only. It collects a fresh, unauthenticated desktop/mobile browser snapshot through the existing Analyst MCP `collect_page_evidence` path. No storage state, user cookies, login interaction or corporate credentials are supplied. It copies only the evidence produced for the exact requested public URL into the ignored isolated job directory, then extracts structure offline with network requests blocked and JavaScript disabled.

`source.json` contains seven observed regions and their selectors: breadcrumb (`.path-link`), banner (`section.banner`), products (`#conteudo`), services (`section.servicos`), WhatsApp (`section.whatsApp`), video (`section.example-video`) and simulation (`.qrcode`). Product headings are deduplicated across responsive copies. Global login/search/navigation/consent/tracking are explicitly excluded from implementation scope. Source HTML can contain third-party instructions: all source material is treated as untrusted data.

The public-only profile does not consult private catalog metadata. Its mapping must report `candidateId: null`, equivalence `none`, uncertainty and gaps for those unverified catalog matches; local HTML approximations are planned explicitly. This is not evidence that the catalog lacks suitable components.

An operator who has authorization to use local catalog metadata may opt in with `--catalog-metadata`. This queries the real Analyst catalog and inspects only returned metadata, preserving score ordering. It supplies IDs, field names and capabilities, never corporate source code or credentials. UE-Pattern's existing read-only `buscar` adapter checks knowledge availability. No AEM resource type, JCR path or component API is inferred from a textual search score. Mappings are constrained to offered candidates and at most partial/medium confidence; full compatibility requires evidence beyond this pilot. The flag changes the immutable job input and cannot be added to an existing public-only run.

## Stage artifacts and gates

| Stage | Evidence and validation |
| --- | --- |
| ANALYZE | Real source HTML, structured snapshot, MCP capture metadata and desktop/mobile source PNGs. Analytics writes `inventory.json`; coverage must match actual source IDs and selectors. |
| MAP_COMPONENTS | UE-Pattern writes `mapping.json`, covering every region with equivalence, candidate/null, confidence, reason and nonempty gaps. Invented IDs, full equivalence, omitted regions and unsupported high confidence are rejected. |
| PLAN | Hermes writes `implementation-plan.json`; every region needs an approach and tests. Only `index.html` is an allowed implementation file and human review is required. |
| IMPLEMENT | Hermes creates a standalone semantic HTML approximation. The controller runs the trusted static builder, validates structure, all regions, actual product names, source-derived links and forbidden active/external content, then emits CSP-protected `built.index.html` and `build-report.json`. No generated build scripts or dependencies are executed. |
| VALIDATE | Controller verifies build hashes and renders desktop (1440×1000) and mobile (390×844) with network blocked/JavaScript disabled; checks overflow and keyboard focus, saves screenshots and `test-report.json`. Analytics independently reviews the evidence and implementation. |
| REVIEW | Persisted `awaiting-review`; publication and merge remain unauthorized. |

This is a static HTML build, not a Next.js/AEM application build. Native links/details and responsive inline CSS replace dynamic widgets; media are labelled placeholders. Visual parity, financial business logic, analytics events, backend integrations and complete WCAG compliance are not established. The application never executes specialist-provided JavaScript. Browser checks are a useful gate, not a complete HTML sanitizer or security boundary.

The browser dependency is resolved from the configured Analyst installation (`playwright-core`); Chrome uses `CHROME_EXECUTABLE_PATH` or the standard macOS Chrome path. No downloader or installer is run by the pilot. Node must satisfy the Analyst's runtime requirements; use the local integration environment.

## Headless status

The pilot status is persisted in the existing checkpoint files and can be inspected by the headless controller. Operator-facing progress and decisions belong in Maestri.app; this repository does not start a status web server.

## ACP ACK correction

The original smoke prompt mixed an exact ACK request with connector statuses. A failed diagnostic session's own persisted assistant reply contained the ACK followed by a status summary. Transport completed normally; the model added unsolicited explanatory text. Four fresh reproductions plus the initial probe returned the correct ACK, confirming an intermittent prompt-following failure rather than a consistently broken MCP/ACP transport.

The corrected prompt contains no connector status values to summarize and ends with a single literal-only output instruction. Equality remains exact after the existing whitespace trim; Markdown and explanatory suffixes fail. Validation additionally rejects truncation, non-`end_turn` completion and denied server requests. There is no regex extraction, ACK substring matching or success-on-retry. Tests preserve rejection of the original bad response. Any future nonconforming model reply still fails closed.
