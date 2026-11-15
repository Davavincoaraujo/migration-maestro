# Experimental Hermes ACP session probe

Run `npm run hermes:acp-session` locally only after successful handshake.

The probe creates a fresh OS temporary directory, starts `hermes acp` with that cwd, sends `initialize` and `session/new` with `mcpServers: []`, checks for a nonempty session ID, terminates the process, and removes the temporary directory. It never sends `session/prompt`, registers client tools, or prints the session ID.

Hermes may load user-level configuration even in a temporary cwd. This probe is **not** a complete sandbox. Do not point it at the corporate portal. No worktree, publishing, model execution, or autonomous operation is enabled.

Server-initiated JSON-RPC requests receive a method-not-available error. Permission handling, persistent sessions, cancellation, MCP capability enforcement, and Maestri desktop integration remain future work. A successful session/new response proves only session creation, not an agent task.
