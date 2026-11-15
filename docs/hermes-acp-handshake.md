# Hermes ACP initialization handshake

Run `npm run hermes:acp-handshake` locally after `npm run hermes:acp-check`.

This experimental adapter starts `hermes acp` with stdio, sends one ACP JSON-RPC `initialize` request, checks the bounded response, then terminates the process. It does not create a session, send a prompt, expose tools, or execute work.

A successful response proves initialization only. It does **not** prove permission prompts, session creation, cancellation, or Maestri integration.

This implementation currently expects a newline-delimited JSON-RPC response with a numeric protocolVersion. If Hermes negotiates a different version or uses a different transport, the probe fails closed. Verify behavior on the local installation before implementing a persistent client.

Never use `hermes -z` for approval-gated automation because its help states approvals are bypassed. Do not use `--yolo` or `--accept-hooks`. Portal source must remain in local worktrees.
