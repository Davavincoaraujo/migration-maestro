import type { RunRecord, WorkflowDefinition } from "../contracts/index.js";
import { validateWorkflow } from "../workflow/validate.js";
/** Crash recovery is conservative: interrupted tasks require human review, never silent replay. */
export function recoverInterruptedRun(workflow: WorkflowDefinition, run: RunRecord, now: string): RunRecord {
  validateWorkflow(workflow);
  if (run.workflowId!==workflow.id || run.workflowVersion!==workflow.version ||
      !Number.isFinite(Date.parse(now)) || run.tasks.length!==workflow.tasks.length ||
      workflow.tasks.some(t=>!run.tasks.some(record=>record.taskId===t.id))) throw new Error("RUN_WORKFLOW_MISMATCH");
  const tasks=run.tasks.map(task=>task.state==="running"?
    {...task,state:"review_required" as const,errorCode:"INTERRUPTED_REQUIRES_REVIEW"}:{...task});
  const interrupted=tasks.some(t=>t.errorCode==="INTERRUPTED_REQUIRES_REVIEW");
  return {...run,tasks,state:interrupted?"review_required":run.state,updatedAt:interrupted?now:run.updatedAt};
}
