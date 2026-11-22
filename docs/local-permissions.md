# Migration Maestro: project-scoped permissions

The existing implementation plan remains active. No agents, sessions, migration
checkpoints, authentication or global settings were replaced.

## Applied

`.claude/settings.json` uses official project settings: manual permission mode,
scoped source/test/documentation edits, the existing portal as an additional
directory, exact check/test/build commands and Maestri list/check. Shell
sandboxing stays enabled, with no unsandboxed retry or automatic approval of
arbitrary sandboxed commands. Sensitive shell operations have ask rules.

The official PreToolUse hook additionally asks before a Write replaces an existing
file, before editing security/credential paths, or before file tools leave the two
authorized roots (including through symlinks). It does not approve any operation;
routine scoped Edit remains subject to the normal rules. Hook activation also
requires Claude workspace trust. Existing agent processes were not restarted.

This file affects Claude sessions loading this project, not unrelated projects.
It does not change the portal's existing local Claude settings. Those contain
broad historical approvals; sessions launched in the portal must not be assumed
to inherit this policy. Rules merge across sources; this file is not an exclusive
security policy and cannot override host-managed restrictions.

Read/Edit rules are not a security boundary around arbitrary scripts. Allowing a
test/build trusts its existing package script and subprocesses. Sensitive actions
can also be expressed through other programs, so the listed ask patterns are not
a proof that every destructive action requires approval. Do not add blanket
`Bash(node *)`, `Bash(python *)`, `Bash(curl *)` or shell approvals.

## Prepared, not activated

`config/permissions/codex-project.toml` is a conservative project-config candidate.
This session has managed approval `never`, protected `.codex`, no TCP access and
no write access to the portal. A project file cannot lift that host policy or
change a running session. The host must activate the policy through its official
project permission settings. Existing user-level `sandbox_mode` must be reconciled
with named profiles; a parsed candidate is not proof of enforcement.

No global config, trust entry, credential file, chmod or OS security setting was
changed. No general allow rule for Git, Node, Python, npm scripts or AEM HTTP was
installed.

## Pending host integration

- Maestri IPC: allow only the exact current `MAESTRI_SOCKET` using the host's Unix
  socket allowlist. It is runtime-specific and must be refreshed by the launcher.
  Do not allow every Unix socket or grant access to the whole temp directory.
- Local HTTP: Claude has endpoint/port allowlist entries, but direct local binding
  stays disabled because that switch grants all local ports on macOS. Test access
  through the supported proxy from the actual Claude session. The outer managed
  sandbox still blocks TCP here.
- Portal edits: host-managed writable roots must include the existing checkout.
- AEM creation: network permission cannot distinguish safe creation from overwrite,
  delete or publication. Automatic writes require a validated create-only executor
  with absence checks, durable receipts and conflict handling; no broad POST/curl
  approval is safe as a substitute. That executor remains an implementation task.
- Agent communication: list/check are preapproved. ask/configuration operations
  remain subject to normal approval until the actual CLI and session are reachable;
  raw terminal input is not preapproved.
- Codex/Claude authentication and named Maestri accounts remain unchanged.

## Validation and official sources

Installed CLIs: Codex 0.169.0 and Claude Code 2.1.322. Codex's official
`app-server --print-startup-config` validates parsing without launching an agent;
Claude's `doctor` validates local setup without model inference. Live enforcement
must be checked in the process that loads the settings, not inferred from JSON.

- https://developers.openai.com/codex/permissions
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/sandboxing

Original-plan next task: connect durable natural-language requests to execution,
keeping blocked stages recoverable and existing migrations read-only on lookup.
