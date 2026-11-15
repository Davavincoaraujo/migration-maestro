import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PromptResult = {
  initialized: boolean;
  sessionCreated: boolean;
  promptSent: boolean;
  promptCompleted: boolean;
  stopReason?: string;
  responseText?: string;
  responseTruncated: boolean;
  updatesReceived: number;
  serverRequestsDenied: number;
  toolsEnabled: false;
  autopilotEnabled: false;
  reason: "COMPLETED" | "INITIALIZE_FAILED" | "SESSION_FAILED" | "PROMPT_FAILED" | "TIMEOUT" | "PROCESS_EXITED" | "PROCESS_UNAVAILABLE" | "PROTOCOL_ERROR";
};

/** ACP prompt runner with bounded text capture; never approves permissions. Treat output as untrusted. */
export async function executeHermesPrompt(
  prompt = "Responda apenas: Hermes conectado ao Migration Maestro.",
  executable = "hermes",
  timeoutMs = 120000
): Promise<PromptResult> {
  if (!/^[a-zA-Z0-9._/-]{1,256}$/.test(executable) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000 ||
      typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    throw new Error("INVALID_PROMPT_CONFIG");
  }
  const dir = await mkdtemp(join(tmpdir(), "migration-maestro-prompt-"));
  try {
    const cwd = await realpath(dir);
    return await new Promise<PromptResult>(resolve => {
      const child = spawn(executable, ["acp"], {
        shell: false, cwd, stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "",
          ...Object.fromEntries(["LANG", "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]
            .filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]!]))
        }
      });
      let settled = false;
      let initialized = false;
      let sessionCreated = false;
      let promptSent = false;
      let updatesReceived = 0;
      let responseText = "";
      let responseTruncated = false;
      let serverRequestsDenied = 0;
      let buffer = "";
      const timer = setTimeout(() => finish("TIMEOUT"), timeoutMs);
      const send = (message: Record<string, unknown>) => {
        if (!settled && child.stdin && !child.stdin.destroyed) {
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
        }
      };
      function finish(reason: PromptResult["reason"], stopReason?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin?.destroy();
        child.kill();
        resolve({
          initialized, sessionCreated, promptSent,
          promptCompleted: reason === "COMPLETED",
          ...(stopReason ? { stopReason } : {}),
          updatesReceived, serverRequestsDenied,
          ...(responseText ? { responseText } : {}), responseTruncated,
          toolsEnabled: false, autopilotEnabled: false, reason
        });
      }
      child.on("error", () => finish("PROCESS_UNAVAILABLE"));
      child.on("close", () => finish("PROCESS_EXITED"));
      child.stdin?.on("error", () => finish("PROCESS_EXITED"));
      // Drain stderr to avoid backpressure; never echo potentially sensitive provider output.
      child.stderr?.on("data", () => {});
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString("utf8");
        if (buffer.length > 65536) return finish("PROTOCOL_ERROR");
        while (!settled) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let msg: Record<string, unknown>;
          try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
            msg = value as Record<string, unknown>;
            if (msg.jsonrpc !== "2.0") throw Error();
          } catch { return finish("PROTOCOL_ERROR"); }
          if (msg.id === 1) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.error || result?.protocolVersion !== 1) return finish("INITIALIZE_FAILED");
            initialized = true;
            send({ id: 2, method: "session/new", params: { cwd, mcpServers: [] } });
          } else if (msg.id === 2) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.error || typeof result?.sessionId !== "string" || !result.sessionId) return finish("SESSION_FAILED");
            sessionCreated = true;
            send({ id: 3, method: "session/prompt", params: {
              sessionId: result.sessionId, prompt: [{ type: "text", text: prompt }]
            } });
            promptSent = true;
          } else if (msg.id === 3) {
            const result = msg.result as Record<string, unknown> | undefined;
            if (msg.error || !result || typeof result.stopReason !== "string") return finish("PROMPT_FAILED");
            finish("COMPLETED", result.stopReason);
          } else if ((typeof msg.id === "number" || typeof msg.id === "string") && typeof msg.method === "string") {
            serverRequestsDenied++;
            if (msg.method === "session/request_permission") {
              send({ id: msg.id, result: { outcome: { outcome: "cancelled" } } });
            } else {
              send({ id: msg.id, error: { code: -32601, message: "Client method unavailable" } });
            }
          } else if (msg.method === "session/update") {
            updatesReceived++;
            const params = msg.params;
            if (!params || typeof params !== "object" || Array.isArray(params)) continue;
            const update = (params as Record<string, unknown>).update;
            if (!update || typeof update !== "object" || Array.isArray(update)) continue;
            const event = update as Record<string, unknown>;
            if (event.sessionUpdate !== "agent_message_chunk") continue;
            const content = event.content;
            if (!content || typeof content !== "object" || Array.isArray(content)) continue;
            const block = content as Record<string, unknown>;
            if (block.type !== "text" || typeof block.text !== "string") continue;
            const remaining = 32768 - responseText.length;
            if (block.text.length > remaining) responseTruncated = true;
            if (remaining > 0) responseText += block.text.slice(0, remaining);
          }
        }
      });
      send({ id: 1, method: "initialize", params: {
        protocolVersion: 1, clientCapabilities: {},
        clientInfo: { name: "migration-maestro", version: "0.1.0" }
      } });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
