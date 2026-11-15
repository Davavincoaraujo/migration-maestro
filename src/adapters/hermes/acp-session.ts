import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SessionProbeResult = {
  initialized: boolean;
  sessionCreated: boolean;
  stage: "starting" | "waiting_initialize" | "waiting_session" | "completed";
  serverRequestsDenied: number;
  notificationsReceived: number;
  stderrObserved: boolean;
  reason: "SESSION_CREATED" | "INITIALIZE_FAILED" | "SESSION_FAILED" | "PROCESS_UNAVAILABLE" | "PROCESS_EXITED" | "TIMEOUT" | "PROTOCOL_ERROR";
};

/** Only initialize and session/new in an isolated temporary directory. Never send session/prompt. */
export async function probeHermesSession(executable = "hermes", timeoutMs = 30000): Promise<SessionProbeResult> {
  if (!/^[a-zA-Z0-9._/-]{1,256}$/.test(executable) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error("INVALID_SESSION_CONFIG");
  }
  const dir = await mkdtemp(join(tmpdir(), "migration-maestro-acp-"));
  try {
    const cwd = await realpath(dir);
    return await new Promise<SessionProbeResult>(resolve => {
      const child = spawn(executable, ["acp"], {
        shell: false, cwd, stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
          ...Object.fromEntries(["LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]
            .filter(key => process.env[key] !== undefined)
            .map(key => [key, process.env[key]!]))
        }
      });
      let settled = false;
      let initialized = false;
      let stage: SessionProbeResult["stage"] = "starting";
      let serverRequestsDenied = 0;
      let notificationsReceived = 0;
      let stderrObserved = false;
      const debug = process.env.MAESTRO_ACP_DEBUG === "1";
      const showStderr = process.env.MAESTRO_ACP_STDERR === "1";
      let buffer = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: Pick<SessionProbeResult, "initialized" | "sessionCreated" | "reason">) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        child.stdin?.destroy();
        child.kill();
        resolve({ ...result, stage, serverRequestsDenied, notificationsReceived, stderrObserved });
      };
      const send = (id: number, method: string, params: Record<string, unknown>) => {
        if (settled || child.stdin?.destroyed) return;
        child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      };
      stage = "waiting_initialize";
      timer = setTimeout(() => finish({ initialized, sessionCreated: false, reason: "TIMEOUT" }), timeoutMs);
      child.on("error", () => finish({ initialized, sessionCreated: false, reason: "PROCESS_UNAVAILABLE" }));
      child.on("close", () => finish({ initialized, sessionCreated: false, reason: "PROCESS_EXITED" }));
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrObserved = true;
        if (showStderr) process.stderr.write(chunk);
        else if (debug) console.error("[HERMES STDERR]", { stage, bytes: chunk.length });
      });
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
            if (debug) console.error("[ACP EVENT]", {
              stage,
              id: typeof msg.id === "number" ? msg.id : typeof msg.id === "string" ? "string-id" : undefined,
              method: typeof msg.method === "string" ? msg.method : undefined,
              hasResult: Object.prototype.hasOwnProperty.call(msg, "result"),
              hasError: Object.prototype.hasOwnProperty.call(msg, "error")
            });
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
            stage = "waiting_session";
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => finish({ initialized, sessionCreated: false, reason: "TIMEOUT" }), timeoutMs);
            send(2, "session/new", { cwd, mcpServers: [] });
          } else if (msg.id === 2) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.error && debug) {
              const error = typeof msg.error === "object" && msg.error !== null
                ? msg.error as Record<string, unknown>
                : {};
              console.error("[ACP SESSION ERROR]", {
                code: typeof error.code === "number" ? error.code : "unknown",
                messageLength: typeof error.message === "string" ? error.message.length : 0,
                hasData: Object.prototype.hasOwnProperty.call(error, "data"),
                dataType: Array.isArray(error.data) ? "array" : typeof error.data,
                dataKeys: error.data && typeof error.data === "object" && !Array.isArray(error.data)
                  ? Object.keys(error.data as Record<string, unknown>).slice(0, 20)
                  : []
              });
              if (process.env.MAESTRO_ACP_ERROR_DETAIL === "1") {
                // Local opt-in only: may contain sensitive provider information.
                console.error("[ACP SESSION ERROR DETAIL]", error.message);
              }
            }
            if (msg.jsonrpc !== "2.0" || msg.error || !result || typeof result.sessionId !== "string" || !result.sessionId) {
              finish({ initialized, sessionCreated: false, reason: "SESSION_FAILED" });
              return;
            }
            // Do not expose sessionId, local paths, or server payloads in diagnostics.
            stage = "completed";
            finish({ initialized: true, sessionCreated: true, reason: "SESSION_CREATED" });
          } else if ((typeof msg.id === "number" || typeof msg.id === "string") && typeof msg.method === "string") {
            // ACP JSON-RPC ids may be strings. Deny all client requests; never authorize tools.
            serverRequestsDenied++;
            sendError(msg.id);
          } else if (typeof msg.method === "string") {
            notificationsReceived++;
          }
        }
      });
      const sendError = (id: number | string) => {
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
