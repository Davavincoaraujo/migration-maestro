/** Local MCP stdio discovery. Never calls tools, writes files, or logs tool payloads. */
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

export const SAFE_ANALYST_TOOLS = [
  "get_migration_context", "search_component_catalog", "inspect_component",
  "collect_page_evidence", "inspect_page_interactions", "capture_page_region",
  "inspect_legacy_source", "run_lighthouse",
] as const;
export interface AnalystToolSummary { name: string; allowed: boolean; }
export async function discoverAnalystTools(directory: string | undefined): Promise<AnalystToolSummary[]> {
  if (!directory || !isAbsolute(directory)) throw new Error("ANALYST_DIRECTORY_NOT_CONFIGURED");
  const root = await realpath(directory).catch(() => { throw new Error("ANALYST_DIRECTORY_NOT_FOUND"); });
  if (!(await stat(root)).isDirectory()) throw new Error("ANALYST_DIRECTORY_INVALID");
  const entry = await realpath(join(root, "mcp", "dist", "src", "server.js"))
    .catch(() => { throw new Error("ANALYST_NOT_BUILT"); });
  const rel = relative(root, entry);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("ANALYST_ENTRY_OUTSIDE_PROJECT");
  const child = spawn(process.execPath, [entry], {
    cwd: root, shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
  });
  return await new Promise<AnalystToolSummary[]>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => done(new Error("ANALYST_TIMEOUT")), 12000);
    const reader = createInterface({ input: child.stdout });
    function done(error?: Error, tools?: AnalystToolSummary[]) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reader.close();
      child.kill();
      if (error) reject(error);
      else resolve(tools ?? []);
    }
    function send(id: number, method: string, params: object) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    }
    child.on("error", () => done(new Error("ANALYST_START_FAILED")));
    child.on("close", () => { if (!finished) done(new Error("ANALYST_EXITED")); });
    reader.on("line", line => {
      if (line.length > 256000) { done(new Error("ANALYST_RESPONSE_TOO_LARGE")); return; }
      try {
        const msg = JSON.parse(line) as { id?: number; error?: unknown; result?: { tools?: { name?: string }[] } };
        if (msg.id === 1) {
          if (msg.error) { done(new Error("ANALYST_HANDSHAKE_FAILED")); return; }
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          send(2, "tools/list", {});
        } else if (msg.id === 2) {
          if (msg.error || !Array.isArray(msg.result?.tools)) { done(new Error("ANALYST_TOOL_DISCOVERY_FAILED")); return; }
          const tools = msg.result.tools.filter(t => typeof t.name === "string").map(t => ({
            name: t.name as string, allowed: (SAFE_ANALYST_TOOLS as readonly string[]).includes(t.name as string),
          }));
          done(undefined, tools);
        }
      } catch { /* Ignore non-JSON diagnostics; no content is logged. */ }
    });
    send(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "migration-maestro", version: "0.1.0" } });
  });
}
