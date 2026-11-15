# Migration Maestro — Maestri.app native workflow

This project runs **inside a Maestri workspace**. The Maestri application is the canvas and agent orchestration layer; the migration-maestro repository provides local tools. Do not assume an undocumented `MAESTRI_SOCKET` variable or a `maestri ask` API.

## One-time setup

1. Open Maestri.app and create/open a **Local** workspace rooted at this repository.
2. Create a terminal using an installed **Codex** or **Claude Code** agent preset (a plain Shell preset is not an autonomous coding agent).
3. In the terminal's **Details** tab, enable **Maestro**.
4. Open the terminal and give it the instructions in `MAESTRI_PROMPT.md`.
5. Optional: create/import roles in Settings → Agents using the `role.json` definitions under `.maestri/roles/`; assign roles to new terminals. A Maestro can recruit specialist agents itself.

Official docs:
- https://www.themaestri.app/en/docs/maestro
- https://www.themaestri.app/pt-br/docs/terminals
- https://www.themaestri.app/pt-br/docs/connections

## Verification

In a terminal inside the Maestri workspace:

```bash
npm ci
npm run check
npm test
npm run integration:smoke -- hero
npm run maestro -- migrate "https://banco.bradesco/html/classic/produtos-servicos/emprestimo-e-financiamento/index.shtm"
```

The `maestro` command is the actual local URL-analysis CLI. It is **not** a claim of autonomous implementation. Maestri's own coding agents must perform the implementation and verification using evidence and approved isolated workspaces.

## Non-negotiable execution gates

- Treat the source URL as public read-only input, never as permission to write to the corporate AEM or repository.
- No corporate source code, credentials, cookies, or private contents in this standalone GitHub repository.
- Create code only in a separate demo repository or isolated worktree with explicit destination authorization.
- Run tests and open a draft PR for review; never merge or publish without approval.
- Report a task as complete only after showing files changed, tests executed, and PR URL when applicable.
