/** Explicit read-only catalog calls; output is reduced to status metadata. */
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

export type CatalogRequest = { tool: "search_component_catalog"; query: string; limit?: number } | { tool: "inspect_component"; idOrName: string };
export function validateCatalogRequest(request: CatalogRequest): { name: string; arguments: Record<string, unknown> } {
  if (request.tool === "search_component_catalog") {
    if (typeof request.query !== "string" || !request.query.trim() || request.query.length > 120 || /[\x00-\x1f]/.test(request.query)) throw new Error("ANALYST_INVALID_QUERY");
    if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20)) throw new Error("ANALYST_INVALID_LIMIT");
    return { name: request.tool, arguments: { query: request.query, ...(request.limit === undefined ? {} : { limit: request.limit }) } };
  }
  if (request.tool === "inspect_component") {
    if (typeof request.idOrName !== "string" || !request.idOrName.trim() || request.idOrName.length > 120 || /[\x00-\x1f]/.test(request.idOrName)) throw new Error("ANALYST_INVALID_COMPONENT");
    return { name: request.tool, arguments: { idOrName: request.idOrName } };
  }
  throw new Error("ANALYST_TOOL_DENIED");
}
export interface LocalCatalogResponse { connected: true; tool: string; resultReceived: true; isError: false; content: unknown[]; }
/** Raw MCP content stays in memory in the local process. Callers must not log or upload it. */
export async function fetchAnalystCatalogLocal(directory: string | undefined, request: CatalogRequest): Promise<LocalCatalogResponse> {
  const call = validateCatalogRequest(request);
  if (!directory || !isAbsolute(directory)) throw new Error("ANALYST_DIRECTORY_NOT_CONFIGURED");
  const root = await realpath(directory).catch(() => { throw new Error("ANALYST_DIRECTORY_NOT_FOUND"); });
  if (!(await stat(root)).isDirectory()) throw new Error("ANALYST_DIRECTORY_INVALID");
  const entry = await realpath(join(root, "mcp", "dist", "src", "server.js")).catch(() => { throw new Error("ANALYST_NOT_BUILT"); });
  const rel = relative(root, entry);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("ANALYST_ENTRY_OUTSIDE_PROJECT");
  const child = spawn(process.execPath, [entry], { cwd: root, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  return new Promise<LocalCatalogResponse>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(new Error("ANALYST_TIMEOUT")), 15000);
    const reader = createInterface({ input: child.stdout });
    function finish(error?: Error, content?: unknown[]) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reader.close();
      child.kill();
      if (error) reject(error);
      else resolve({ connected: true, tool: call.name, resultReceived: true, isError: false, content: content ?? [] });
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
          if (msg.error || !msg.result?.tools?.some(t => t.name === call.name)) return finish(new Error("ANALYST_CATALOG_TOOL_UNAVAILABLE"));
          send(3, "tools/call", call);
        } else if (msg.id === 3) {
          if (msg.error || msg.result?.isError || !Array.isArray(msg.result?.content)) return finish(new Error("ANALYST_CATALOG_CALL_FAILED"));
          finish(undefined, msg.result.content);
        }
      } catch { /* Never log tool output. */ }
    });
    send(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "migration-maestro", version: "0.1.0" } });
  });
}

/** Backwards-compatible status-only smoke test. */
export async function probeAnalystCatalog(directory: string | undefined, request: CatalogRequest): Promise<{ connected: true; tool: string; resultReceived: true; isError: false }> {
  const { content: _privateContent, ...status } = await fetchAnalystCatalogLocal(directory, request);
  return status;
}
