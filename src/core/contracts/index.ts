/** Provider-agnostic contracts. No SDK, UI or migration-domain dependencies. */
export type Id = string;
export type TaskState = "pending" | "ready" | "running" | "review_required" | "completed" | "failed" | "blocked" | "cancelled";
export type RunState = "pending" | "running" | "review_required" | "completed" | "failed" | "cancelled";
export type ToolEffect = "read" | "write" | "execute" | "publish" | "external";
export type ApprovalState = "requested" | "approved" | "rejected";
export interface ModelDefinition {
  id: Id;
  provider: string;
  capabilities: string[];
  contextWindow?: number;
  costPerMillionInputTokensUsd?: number;
  costPerMillionOutputTokensUsd?: number;
}
export interface AgentDefinition {
  id: Id;
  adapter: string;
  capabilities: string[];
  allowedTools: Id[];
  preferredModels?: Id[];
}
export interface ToolDefinition {
  id: Id;
  adapter: string;
  effect: ToolEffect;
  inputSchema?: Record<string, unknown>;
}
export interface TaskDefinition {
  id: Id;
  label: string;
  capability: string;
  dependsOn: Id[];
  toolIds: Id[];
  requiresApproval: boolean;
}
export interface WorkflowDefinition {
  id: Id;
  version: number;
  tasks: TaskDefinition[];
}
export interface TaskRecord {
  taskId: Id;
  state: TaskState;
  attempt: number;
  agentId?: Id;
  modelId?: Id;
  evidenceIds: Id[];
  errorCode?: string;
}
export interface RunRecord {
  id: Id;
  workflowId: Id;
  workflowVersion: number;
  state: RunState;
  tasks: TaskRecord[];
  createdAt: string;
  updatedAt: string;
}
export interface ApprovalRecord {
  id: Id;
  runId: Id;
  taskId: Id;
  state: ApprovalState;
  requestedAt: string;
  decidedAt?: string;
  actorId?: string;
  evidenceIds: Id[];
}
export interface EvidenceRecord {
  id: Id;
  runId: Id;
  taskId: Id;
  kind: string;
  localRef: string;
  sha256: string;
  createdAt: string;
}
export interface AgentAdapter {
  readonly id: string;
  checkAvailability(): Promise<boolean>;
  execute(input: { runId: Id; task: TaskDefinition; modelId?: Id; worktree?: string }): Promise<{ status: "completed" | "failed" | "review_required"; evidenceIds: Id[]; errorCode?: string }>;
}
export interface ToolAdapter {
  readonly id: string;
  invoke(input: unknown, context: { runId: Id; taskId: Id; approved: boolean }): Promise<unknown>;
}
