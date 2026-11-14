# Portal registry discovery — source-grounded contract

The supplied `scripts/generate-component-registries.ts` recursively scans `src/frontend/components/**/definition.ts`. It extracts `name`, `version`, `group`, optionally detects sibling `mapper.ts`, and generates per-group static entries plus a central `componentRegistry` and `groupIndex` under `src/common/generated/registry`.

## Identity
- Qualified key: `group/name@version`
- Definition import: `@/frontend/components/.../definition`
- Component import: `@/frontend/components/.../<ComponentName>`
- Optional mapper import: sibling `mapper.ts`
- `modelId` is explicitly validated and checked for collisions, including subitem IDs.

**Important:** `modelId` must not automatically be assumed to equal the AEM JCR `sling:resourceType`. The actual UE/AEM mapping must be verified against the project's definition schema and documentation before connecting to real AEM.

## Build behavior
`PORTAL_GROUPS` selects groups; absent filter means all groups. Filtering is applied after validations. This can influence which components are available in a particular build, and should be part of the migration planning context.

## Integration approach
1. Run existing registry generation locally without modifying it.
2. Add a separate local export utility after confirming actual `definition.ts` shape.
3. Export only sanitized metadata to Maestro.
4. Validate qualified keys, models, versions, and mapper presence.
5. Generate proposed mappings, flag unknown components, and require review.

This PR introduces a **pure transformation contract**, not an automatic filesystem scanner or live local connection.
