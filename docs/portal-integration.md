# Local portal integration plan

## Observed from user-provided package.json
- Next.js 16.1.7, React 19.2.3, TypeScript 5
- `generate:registries` invokes `tsx scripts/generate-component-registries.ts`
- `predev`, `prebuild`, `pretest` invoke registry generation
- Jest, Playwright, Storybook and AJV are available
- Local project: `~/developer/iibr-fed-portalbradesco` (not accessible by this GitHub connector)

## Proposed contract
1. A read-only local inspector exports a sanitized component manifest.
2. Maestro consumes that manifest, resolves resourceType to existing component metadata, and flags unknown mappings.
3. Maestro produces migration proposals and validation results; no direct writes to the local portal.
4. A separate, explicitly authorized local executor may apply approved patches later.
5. GitHub PRs remain subject to human review.

## Required inspection before implementation
Read `scripts/generate-component-registries.ts`, `scripts/registry-utils.ts`, `next.config.ts`, and `documentation/padrao-universo-editor-adobe.md`. Do not assume their output shape.

## Security review
- Local `dev` currently uses `NODE_TLS_REJECT_UNAUTHORIZED=0`; replace with trusted development CA configuration where feasible.
- Build copies `.env.production` into distribution; verify it contains no secrets and is excluded from source control and artifacts when inappropriate.
- Never upload proprietary code or secrets to personal GitHub.
