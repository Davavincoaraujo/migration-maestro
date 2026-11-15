# Maestri is the primary interface

## Decision
Maestri is the **required operator interface** for Maestro Core. The project does not ship a competing dashboard. The Core remains a local engine for contracts, task state, policies and persistence; operators manage agents and visual collaboration in Maestri.

## Supported discovery
Maestri documents its own CLI and `maestri list`. Run `npm run maestri:discover` **inside a Maestri terminal** to inspect visible agents. Output is displayed as plain text, not parsed into an invented API schema. The command fails closed when Maestri is unavailable. Never read private Maestri application databases or assume an HTTP API.

## Setup
1. Open the repository directory as a workspace in the Maestri desktop app.
2. Start a terminal for your installed Claude Code, Codex or other supported agent.
3. In terminal settings, use the Maestri **Discover Roles** feature to import the `role.json` files under `.maestri/`. Role schema and discovery behavior should be checked against the installed Maestri version.
4. Assign the Maestro Core role to the coordinating terminal, Implementador to a coding terminal and Revisor to a review terminal.
5. Connect terminals visually. Maestri's own skill provides agent-to-agent messaging.
6. Run `npm run maestri:discover` from a terminal in that workspace. Check actual CLI output.
7. Continue using the Core's approval gates and local run snapshots. Maestri UI approvals do not automatically grant Core authorization.

## Limitations
- The discovery command detects what `maestri list` exposes **in the active terminal context**, not every installed model, MCP server or account.
- No confirmed machine-readable output format is assumed; mapping CLI output to the Agent Registry remains future integration work.
- No Maestri application files, secrets or bridge tokens are read.
- The Maestri desktop app must be installed and configured on the operator's machine.
- Legacy `maestro:web` remains temporarily for compatibility, but is not the target UI.

Official references: https://www.themaestri.app/pt-br/docs/terminals and https://www.themaestri.app/pt-br/docs/connections
