# Hermes ACP integration: dependency preflight

Hermes v0.23.1 exposes `hermes acp` for editor integration and `hermes acp --check` to verify ACP dependencies and imports.

Run `npm run hermes:acp-check` locally. The command runs **only** `hermes acp --check`, with no shell, prompt, ACP session, model call, or tools. It reports availability, not a connected session.

**Not yet implemented:** ACP JSON-RPC handshake, session creation, tool permission forwarding, cancellation, audit logging, or Maestri UI integration. Do not use `hermes -z` for autopilot: the installed CLI states oneshot bypasses approvals. Do not use `--yolo` or `--accept-hooks`.

Next: verify ACP client/server transport and permission behavior with a sandboxed synthetic workspace before enabling tasks. Maintain explicit human review and local-only corporate worktrees.
