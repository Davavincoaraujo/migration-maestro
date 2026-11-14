import { validateToolRequest, type ReadTool, type ToolResponse } from "./contracts.js";

/**
 * In-process read-only dispatch boundary. A real MCP transport may invoke it
 * later, after identity and authorization are established.
 */
export type ReadHandler = (args: Readonly<Record<string, unknown>>) => Promise<unknown>;
export type ReadHandlers = Partial<Record<ReadTool, ReadHandler>>;
const keys = new Set(["source.list", "source.read", "target.preview", "job.status"]);
export function createReadDispatcher(handlers: ReadHandlers) {
  for (const name of Object.keys(handlers)) {
    if (!keys.has(name)) throw new Error("Unsupported handler");
  }
  return async (raw: unknown): Promise<ToolResponse> => {
    let request;
    try { request = validateToolRequest(raw); }
    catch { return { ok: false, error: "tool-not-allowed" }; }
    const handler = handlers[request.tool];
    if (!handler) return { ok: false, error: "tool-not-configured" };
    try {
      // Do not pass a mutable reference to the caller's input to adapters.
      const result = await handler(structuredClone(request.args));
      if (result === undefined) return { ok: false, error: "empty-result" };
      const json = JSON.stringify(result);
      if (!json || json.length > 1_000_000) return { ok: false, error: "response-too-large" };
      return { ok: true, data: JSON.parse(json) as unknown };
    } catch {
      // Never disclose source data or exception details to remote callers.
      return { ok: false, error: "tool-execution-failed" };
    }
  };
}
