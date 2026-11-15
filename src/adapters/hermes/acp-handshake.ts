import { spawn } from "node:child_process";

export type AcpHandshakeResult = {
  connected: boolean;
  reason: "INITIALIZE_OK" | "PROCESS_UNAVAILABLE" | "TIMEOUT" | "PROTOCOL_ERROR" | "PROCESS_EXITED";
  protocolVersion?: number;
};

export interface AcpHandshakeConfig {
  executable?: string;
  args?: string[];
  timeoutMs?: number;
}

/**
 * One bounded ACP JSON-RPC initialize request over stdio.
 * No session/new, prompts, model calls, permissions, or agent tools.
 * Output is intentionally reduced to status metadata.
 */
export function probeAcpHandshake(config: AcpHandshakeConfig = {}): Promise<AcpHandshakeResult> {
  const executable = config.executable ?? "hermes";
  const args = config.args ?? ["acp"];
  const timeoutMs = config.timeoutMs ?? 10000;
  const safe = /^[a-zA-Z0-9._/-]{1,256}$/;
  if (!safe.test(executable) || !Array.isArray(args) || args.length > 8 ||
      args.some(arg => typeof arg !== "string" || !safe.test(arg)) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new Error("INVALID_ACP_CONFIG");
  }
  return new Promise(resolve => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }
    });
    let settled = false;
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: AcpHandshakeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.stdin?.destroy();
      child.kill();
      resolve(result);
    };
    timer = setTimeout(() => finish({ connected: false, reason: "TIMEOUT" }), timeoutMs);
    child.on("error", () => finish({ connected: false, reason: "PROCESS_UNAVAILABLE" }));
    child.on("close", () => finish({ connected: false, reason: "PROCESS_EXITED" }));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      if (buffer.length > 65536) {
        finish({ connected: false, reason: "PROTOCOL_ERROR" });
        return;
      }
      while (buffer.includes("\n") && !settled) {
        const pos = buffer.indexOf("\n");
        const line = buffer.slice(0, pos).trim();
        buffer = buffer.slice(pos + 1);
        if (!line) continue;
        let message: unknown;
        try { message = JSON.parse(line); }
        catch { finish({ connected: false, reason: "PROTOCOL_ERROR" }); return; }
        if (typeof message !== "object" || message === null) {
          finish({ connected: false, reason: "PROTOCOL_ERROR" }); return;
        }
        const msg = message as Record<string, unknown>;
        if (msg.id !== 1) continue;
        if (msg.jsonrpc !== "2.0" || msg.error || !msg.result || typeof msg.result !== "object") {
          finish({ connected: false, reason: "PROTOCOL_ERROR" }); return;
        }
        const version = (msg.result as Record<string, unknown>).protocolVersion;
        if (typeof version !== "number" || !Number.isSafeInteger(version)) {
          finish({ connected: false, reason: "PROTOCOL_ERROR" }); return;
        }
        finish({ connected: true, reason: "INITIALIZE_OK", protocolVersion: version });
      }
    });
    const request = {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "migration-maestro", version: "0.1.0" } }
    };
    child.stdin?.on("error", () => finish({ connected: false, reason: "PROCESS_EXITED" }));
    child.stdin?.write(JSON.stringify(request) + "\n");
  });
}
