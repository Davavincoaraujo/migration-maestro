import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SessionProbeResult = {
  initialized: boolean;
  sessionCreated: boolean;
  reason: "SESSION_CREATED" | "INITIALIZE_FAILED" | "SESSION_FAILED" | "PROCESS_UNAVAILABLE" | "PROCESS_EXITED" | "TIMEOUT" | "PROTOCOL_ERROR";
};

/** Only initialize and session/new in an isolated temporary directory. Never send session/prompt. */
export async function probeHermesSession(executable = "hermes", timeoutMs = 15000): Promise<SessionProbeResult> {
  if (!/^[a-zA-Z0-9._/-]{1,256}$/.test(executable) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new Error("INVALID_SESSION_CONFIG");
  }
  const dir = await mkdtemp(join(tmpdir(), "migration-maestro-acp-"));
  try {
    const cwd = await realpath(dir);
    return await new Promise<SessionProbeResult>(resolve => {
      const child = spawn(executable, ["acp"], {
        shell: false, cwd, stdio: ["pipe", "pipe", "ignore"],
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }
      });
      let settled = false;
      let initialized = false;
      let buffer = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: SessionProbeResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        child.stdin?.destroy();
        child.kill();
        resolve(result);
      };
      const send = (id: number, method: string, params: Record<string, unknown>) => {
        if (settled || child.stdin?.destroyed) return;
        child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      };
      timer = setTimeout(() => finish({ initialized, sessionCreated: false, reason: "TIMEOUT" }), timeoutMs);
      child.on("error", () => finish({ initialized, sessionCreated: false, reason: "PROCESS_UNAVAILABLE" }));
      child.on("close", () => finish({ initialized, sessionCreated: false, reason: "PROCESS_EXITED" }));
      child.stdin?.on("error", () => finish({ initialized, sessionCreated: false, reason: "PROCESS_EXITED" }));
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString("utf8");
        if (buffer.length > 65536) {
          finish({ initialized, sessionCreated: false, reason: "PROTOCOL_ERROR" });
          return;
        }
        while (buffer.includes("\n") && !settled) {
          const pos = buffer.indexOf("\n");
          const line = buffer.slice(0, pos).trim();
          buffer = buffer.slice(pos + 1);
          if (!line) continue;
          let msg: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(line);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
            msg = parsed as Record<string, unknown>;
          } catch {
            finish({ initialized, sessionCreated: false, reason: "PROTOCOL_ERROR" });
            return;
          }
          if (msg.id === 1) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.jsonrpc !== "2.0" || msg.error || !result || result.protocolVersion !== 1) {
              finish({ initialized: false, sessionCreated: false, reason: "INITIALIZE_FAILED" });
              return;
            }
            initialized = true;
            send(2, "session/new", { cwd, mcpServers: [] });
          } else if (msg.id === 2) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.jsonrpc !== "2.0" || msg.error || !result || typeof result.sessionId !== "string" || !result.sessionId) {
              finish({ initialized, sessionCreated: false, reason: "SESSION_FAILED" });
              return;
            }
            // Do not expose sessionId, local paths, or server payloads in diagnostics.
            finish({ initialized: true, sessionCreated: true, reason: "SESSION_CREATED" });
          } else if (typeof msg.id === "number") {
            // Do not service server-initiated requests; no permission or tool requests are authorized.
            sendError(msg.id);
          }
        }
      });
      const sendError = (id: number) => {
        if (settled || child.stdin?.destroyed) return;
        child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Client method not available" } }) + "\n");
      };
      send(1, "initialize", {
        protocolVersion: 1, clientCapabilities: {},
        clientInfo: { name: "migration-maestro", version: "0.1.0" }
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
