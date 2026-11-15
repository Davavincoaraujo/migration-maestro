import type { ApprovalRecord, TaskDefinition, ToolDefinition } from "../contracts/index.js";
export type AuthorizationDecision = { allowed: true } | { allowed: false; reason: "APPROVAL_REQUIRED" | "APPROVAL_REJECTED" | "TOOL_NOT_ALLOWED" | "TOOL_NOT_REGISTERED" };
/** Deny by default for any side-effecting tool, even if task.requiresApproval is false. */
export function authorizeTool(task: TaskDefinition, toolId: string, tools: ReadonlyMap<string, ToolDefinition>, runId: string, approval?: ApprovalRecord): AuthorizationDecision {
  if (!task.toolIds.includes(toolId)) return {allowed:false,reason:"TOOL_NOT_ALLOWED"};
  const tool=tools.get(toolId);
  if (!tool) return {allowed:false,reason:"TOOL_NOT_REGISTERED"};
  if (tool.effect==="read" && !task.requiresApproval) return {allowed:true};
  if (approval?.state==="rejected") return {allowed:false,reason:"APPROVAL_REJECTED"};
  if (approval?.state==="approved" && approval.taskId===task.id && approval.runId===runId && approval.actorId && approval.decidedAt) return {allowed:true};
  return {allowed:false,reason:"APPROVAL_REQUIRED"};
}
