import type { RunRecord, TaskRecord, WorkflowDefinition } from "../contracts/index.js";
import { validateWorkflow } from "./validate.js";
/** Pure planning: no agent execution, no I/O, no implicit approval. */
export function createRunPlan(workflow: WorkflowDefinition, runId: string, now: string): RunRecord {
  validateWorkflow(workflow);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId) || !Number.isFinite(Date.parse(now))) throw new Error("INVALID_RUN_METADATA");
  const tasks: TaskRecord[] = workflow.tasks.map(task => ({
    taskId: task.id, state: task.dependsOn.length ? "pending" : task.requiresApproval ? "review_required" : "ready",
    attempt: 0, evidenceIds: [],
  }));
  return { id: runId, workflowId: workflow.id, workflowVersion: workflow.version,
    state: tasks.some(t => t.state === "review_required") ? "review_required" : "pending",
    tasks, createdAt: now, updatedAt: now };
}
