# Metadata catalog — stage 2

The Maestro can now aggregate many **evaluated and sanitized** component metadata JSON files into one deterministic catalog.

1. Generate individual structural metadata files locally with `npm run metadata:export -- <evaluated-definition.json> <local-output/component.json>`.
2. Place the exported JSON files in a dedicated input folder (for example `local-output/components/`).
3. Run `npm run metadata:catalog -- ./local-output/components ./local-output/catalog.json`.
4. Run `npm test` and `npm run check`.

The catalog rejects duplicate component IDs, malformed model IDs, invalid parent-child relationships and excessively large inputs. It outputs only component aliases, container topology and aggregate counts.

**Current limit:** the exporter requires evaluated definition JSON; it does not import `definition.ts` or execute portal code. Integrating direct portal discovery should be done with a locally installed, reviewed adapter running within the approved corporate environment. The catalog is not a JCR writer and cannot authorize production changes. Hash aliases are pseudonymous; review the resulting catalog before external sharing.
