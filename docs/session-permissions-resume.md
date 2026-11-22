# Resume the existing Maestri session permissions

This is an operational handoff, not an activated policy. Preserve the existing
terminals, checkpoints, receipts, roles and implementation. Do not recreate the
pilot or replace agents to fix an access denial.

## Verified configuration mechanisms

The installed Maestri skill documents `maestri preset list`, `preset show`, and
`preset set "Name" --command "..."`. Presets configure the command for newly
launched terminals. They are not a documented live Seatbelt editor and changing a
preset does not establish access for this running session. The CLI's `help` and
`debug` both require IPC; help cannot currently enumerate additional capabilities.
Do not invent an application Settings path or change a synced preset blindly.

Codex CLI `--help` confirms `--add-dir <DIR>` for an additional writable checkout,
`--config key=value` for invocation settings, and `resume` for existing history.
Use those through the supported launcher only when needed; no session was
restarted here. Named permission profiles are the documented alternative to the
legacy sandbox configuration. Do not mix the two systems. The existing candidate
`config/permissions/codex-project.toml` remains uninstalled and network-disabled.

For an active named profile the documented controls are:

- `permissions.<name>.workspace_roots`: include the existing portal checkout.
- `permissions.<name>.network.enabled` and `features.network_proxy`: both are
  necessary for network access with enforced host filtering.
- `permissions.<name>.network.unix_sockets`: allow only the current exact
  `MAESTRI_SOCKET`, supplied by the launcher, never all sockets or temp directories.
- `permissions.<name>.network.domains`: exact loopback hosts can be allowed, but
  this control normalizes away ports. It cannot enforce only 3000 and 4502.
  A host-enforced destination/port policy is required for that narrower boundary.

Host/administrator requirements can restrict these settings. Config in this repo
cannot grant access denied by the effective outer managed sandbox. Do not start a
second agent, daemon or proxy as a substitute, and do not use full-access flags.

Claude is a separate permission system. Its `/status` lists setting sources;
`/sandbox` is the official sandbox panel, subject to higher-priority settings.
`sandbox.network.allowUnixSockets` is an exact socket list. Additional directories
and `sandbox.filesystem.allowWrite` control filesystem access. On macOS,
`allowLocalBinding=true` opens all localhost ports for direct connections, so it
does not meet a 3000/4502-only boundary. These settings cannot lift the outer
Codex/host policy. Project trust and intended-account authentication remain
separate unresolved gates; never put credentials in chat or reports.

## Current activation boundary and next steps

This session still has approval `never`, restricted network and writable roots
limited to migration-maestro and temporary directories. The exact Maestri socket
exists but connection returns EPERM; direct TCP probes to 127.0.0.1:3000/4502 also
return EPERM. No write probe against the portal was attempted. The three AEM auth
environment variables recorded in the checkpoint are still absent.

The execution host owner must apply the scoped permissions through its supported
session/launcher controls. A live permission update mechanism for this Maestri
host could not be verified while IPC is blocked. Keep the same conversation when
the host supports updating it; if it requires a restart, explicitly preserve and
resume the existing session rather than silently replacing terminals.

After the effective permissions change, resume the saved operational sequence:
list/check existing agents, verify local HTTP without writes, apply the already
checked portal TypeScript patch, run the standard portal typecheck, and continue
the original checkpointed workflow. Existing create receipts must be reconciled
before retrying writes. Independent browser acceptance remains pending.

## Sources checked on 2026-11-16

- Installed `maestri-manager/SKILL.md`, preset and resume sections.
- Installed `codex --help` and `codex app-server --help`.
- https://learn.chatgpt.com/docs/permissions (profile roots, exact sockets,
  host normalization, proxy enforcement and managed requirements).
- https://code.claude.com/docs/en/sandboxing (setting precedence, localhost and
  Unix socket settings).

The shell manual-download helper failed DNS resolution. Official pages were
retrieved with the web documentation tool instead. No global/user/project
security configuration was installed or changed during this continuation.
