/**
 * MCP integration boundary. Future transport can map these commands to
 * MCP tools after explicit allowlisting and user authorization.
 */
export const allowedReadTools = ["source.list", "source.read", "target.preview", "job.status"] as const;
export type ReadTool = typeof allowedReadTools[number];
export interface ToolRequest { tool: ReadTool; args: Record<string, unknown>; }
export interface ToolResponse { ok: boolean; data?: unknown; error?: string; }
export function validateToolRequest(value: unknown): ToolRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid tool request");
  const request = value as Record<string, unknown>;
  if (typeof request.tool !== "string" || !allowedReadTools.some(tool => tool === request.tool)) {
    throw new Error("Tool is not allowlisted");
  }
  if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) {
    throw new Error("Invalid tool arguments");
  }
  return { tool: request.tool as ReadTool, args: request.args as Record<string, unknown> };
}
