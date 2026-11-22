# Mapper/exporter contracts

The local workflow requires a contract artifact per mapped source section before
implementation or AEM/DAM writes. Existing AEM names, fields, model types and
React props are preserved: schemas describe inspected contracts, not replacements.
No mapper/exporter code is imported or evaluated by the coordinator.

Each mapping section adds `contractFile` (a relative job artifact path) and
`nodePath` (an array starting with `jcr:content`, identifying the component node in
`implementation.json` page). Component node paths must be unique.

The artifact follows `MapperExporterContract` in
`src/autopilot/mapper-exporter-contract.ts`:

- `sourceId`, `resourceType`, matching the mapping exactly.
- `definition`, `mapper`, `exporter`: `{file,digest}` source references within the
  authorized project's existing `src/` or `scripts/maestro/` scope, with SHA-256
  digests. Definition must match `definitionFile`. Missing/out-of-scope exporter
  sources block verification; do not create placeholder sources to satisfy it.
- `contentSchema`, `modelSchema`, `propsSchema`: bounded structural schemas.
- `variants`: nonempty `{id,evidence:[...]}` inventory of observed/required
  rendering or data variants, with evidence for each variant. IDs are unique.
- `fixtures`: nonempty `{variantId,content,model,props,evidence:[...]}` examples
  drawn from inspected sources or captured outputs. Every declared variant must
  have at least one fixture and undeclared variants are rejected. Exported model
  `:type` must equal the mapped resource type. Evidence must identify where each
  example came from.

Schemas support `type` (object, array, union, string, number, integer, boolean,
null), bounded `anyOf` variants for real nullable/conditional mapper outputs, and
optional scalar `enum`. Objects require `properties`, `required` and
`additionalProperties:false`; arrays require `items`. Unsupported schema keywords
are rejected. Nested structures are limited to 20 levels. Fields such as JCR
metadata must be included explicitly when present; silently discarding unknown
fields or coercing values is not allowed.

The coordinator validates all fixture boundaries, source hashes, mapping identity
and actual implementation component nodes against content schemas. Contract
artifacts become hashed checkpoint evidence. Source hashes are checked again on
resume and before writes. A missing or stale contract requires fresh evidenced
mapping in the same job; never erase a completed checkpoint to force dispatch.

This gate establishes structural consistency and declared-variant fixture
coverage, not proof that executing an AEM exporter and Next.js mapper yields the
supplied outputs. Runtime equivalence and real browser behavior still require
independently captured acceptance in the authorized environment. Historical
checkpoints remain preserved; legacy manifests without contracts cannot authorize
new implementation or writes.
