# Local execution through Maestri

The existing central controller now accepts a production workflow extension from
`autopilot:intake`. Its default `autopilot:central` invocation is still a synthetic
demo. No additional scheduler, server or visual interface was introduced.

## Entry and persistence

The coordinator runs `npm run autopilot:intake -- "<original request>"` for a URL,
"Migre esta página: <URL>", or a correction including the reported defects. The
command now invokes execution, rather than returning a queued record alone.
Completed migrations are recovered without agent dispatch or AEM writes.

Historical local reports are discovered by directory and report ID, without a
hard-coded pilot ID. New jobs derive stable 20-hex checkpoint IDs from the registry
record. Repeated pending correction text retains its job identity. User-reported
defects are persisted even with an empty errors array; implementation requires a
finding marked verified with current evidence and implicated files.

The registry request lock serializes intake/update/execution. The controller lock,
stage receipts and artifact hashes remain authoritative. Stale locks require
operator reconciliation, never automatic removal of another worker's lock.

## Local stages

ANALYZE → DISCOVER_COMPONENTS → MAP_COMPONENTS → PLAN → IMPLEMENT →
CREATE_AEM_CONTENT → UPLOAD_DAM_ASSETS → VALIDATE → REVIEW.

The existing controller selects connected sessions using visible model metadata.
Source analysis uses the existing Analyst MCP adapter. Component discovery uses a
read-only index of real portal definition files. Mapping checks literal component
names, resource types, section coverage, and authenticated live template/policy
existence. This is a minimum gate, not a complete semantic proof of mapper, field,
exporter or business compatibility. Those remain specialist/Validator duties.

Hermes writes scoped portal implementation and a structured manifest. Coordinator
code alone performs AEM writes; no credentials enter agent prompts. Page import
uses an explicit name, replace=false and replaceProperties=false. DAM uses the
Assets API create operation, never PUT. New DAM folders are created only when
absent; byte-identical existing assets are reused read-only. Conflicting assets
and pages are never overwritten. The page's parent must already exist.

Each external creation persists intent before POST. After uncertain delivery,
resume reconciles via GET and expected content/hash; an absent or different target
blocks automatic re-send. New pages carry a job marker for reconciliation. The
client has no delete, publish, overwrite or credential-change API.

Correction runs omit page/DAM creation. A correction requiring changes to existing
AEM properties or conflicting asset binaries is a blocker requiring a separately
reviewed safe operation. It must not be described as repaired by code edits alone.

The workflow checks portal file hashes before continuing or resuming. Captured
validation includes checks for tests, TypeScript, build, Next.js, model.json, DAM,
desktop/mobile and accessibility. Failed checks block; unverified checks retain
human review. Structured agent statements alone are not proof of browser results.

## Required environment

Use the installed Node version in `.nvmrc` (22.23.2). Test, intake and router
scripts use `node --import tsx` to avoid the tsx CLI's extra IPC listener.

Existing checkout: `/Users/macos/Developer/iibr-fed-portalbradesco`.
Existing Analyst: `/Users/macos/Developer/migration-analyst`.
The Author must be local HTTP on port 4502. Provide existing authentication only
through `MAESTRO_AEM_AUTHOR_URL`, `MAESTRO_AEM_USER` and
`MAESTRO_AEM_PASSWORD`. No default credentials or automatic secret-file import is
used. Do not expose values in prompts or logs.

See [project permissions](local-permissions.md). Host-managed IPC/network/write
restrictions cannot be lifted by repository settings. No sessions are restarted
to apply settings automatically.

## Router costs and fallback

Complexity signals for the local workflow use plan file/task counts, operation
risk and correction scope. Context size supplies a heuristic token reservation;
it is not measured provider usage. Deterministic AEM/DAM stages call no model.

Verified price comparisons precede preferred-agent tie breaking. Optional prices
in `config/model-router.json` require provider/model, API billing mode, source URL
and verification timestamp. Applying them to a session also requires an explicit
matching `sessionBilling` attestation with evidence. Subscription login and model
catalogs alone never imply API billing rates. No rates or billing attestations
have been invented or activated. Estimated costs remain separate from usage.

Pre-dispatch rate limits exclude the unavailable provider. Fallback requires a
different authorized active session with matching capability/profile. Ambiguous
already-dispatched tasks are not resent to another provider. Live cross-provider
fallback still needs authenticated reachable sessions and acceptance evidence.

## Current acceptance limits

Unit/fixture integration tests cover workflow dispatch, local gates, stable
recovery, external-write reconciliation and conflict rejection. They do not prove
live Maestri or AEM integration. The current host blocks Maestri IPC and local HTTP;
Claude is unauthenticated and project trust is not accepted. No new live migration
or live correction has been completed by this implementation session.

`npm run autopilot:revalidate -- <record-id>` performs only current read-only file
and HTTP probes. It never runs historical scripts or reuses historical success.
Portal tests/build and browser/video validation are explicitly unverified there.

Outstanding engineering: automatic handling of missing component contracts,
complete schema/exporter compatibility validation, safe correction of existing
AEM content when required, post-dispatch provider reconciliation/fallback, actual
provider usage telemetry and fully independent captured browser acceptance.
Persistent Maestri role/preset activation and permission validation remain blocked
until the official CLI is reachable.
