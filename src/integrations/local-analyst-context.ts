/** One explicitly permitted, parameter-free MCP tool call. No result content is printed or persisted. */
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

export async function probeAnalystContext(directory: string | undefined): Promise<{ connected: true; tool: "get_migration_context"; resultReceived: true; isError: false }> {
  if (!directory || !isAbsolute(directory)) throw new Error("ANALYST_DIRECTORY_NOT_CONFIGURED");
  const root = await realpath(directory).catch(() => { throw new Error("ANALYST_DIRECTORY_NOT_FOUND"); });
  if (!(await stat(root)).isDirectory()) throw new Error("ANALYST_DIRECTORY_INVALID");
  const entry = await realpath(join(root, "mcp", "dist", "src", "server.js")).catch(() => { throw new Error("ANALYST_NOT_BUILT"); });
  const rel = relative(root, entry);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("ANALYST_ENTRY_OUTSIDE_PROJECT");
  const child = spawn(process.execPath, [entry], { cwd: root, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(new Error("ANALYST_TIMEOUT")), 15000);
    const reader = createInterface({ input: child.stdout });
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reader.close();
      child.kill();
      if (error) reject(error);
      else resolve({ connected: true, tool: "get_migration_context", resultReceived: true, isError: false });
    }
    function send(id: number, method: string, params: object) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    }
    child.on("error", () => finish(new Error("ANALYST_START_FAILED")));
    child.on("close", () => { if (!finished) finish(new Error("ANALYST_EXITED")); });
    reader.on("line", line => {
      if (line.length > 256000) return finish(new Error("ANALYST_RESPONSE_TOO_LARGE"));
      try {
        const msg = JSON.parse(line) as { id?: number; error?: unknown; result?: { tools?: { name?: string }[]; isError?: boolean; content?: unknown[] } };
        if (msg.id === 1) {
          if (msg.error) return finish(new Error("ANALYST_HANDSHAKE_FAILED"));
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          send(2, "tools/list", {});
        } else if (msg.id === 2) {
          if (msg.error || !msg.result?.tools?.some(t => t.name === "get_migration_context")) return finish(new Error("ANALYST_CONTEXT_TOOL_UNAVAILABLE"));
          send(3, "tools/call", { name: "get_migration_context", arguments: {} });
        } else if (msg.id === 3) {
          if (msg.error || msg.result?.isError || !Array.isArray(msg.result?.content)) return finish(new Error("ANALYST_CONTEXT_CALL_FAILED"));
          finish();
        }
      } catch { /* No raw server content logged. */ }
    });
    send(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "migration-maestro", version: "0.1.0" } });
  });
}
