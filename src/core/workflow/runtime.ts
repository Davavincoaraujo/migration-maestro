import type { ApprovalRecord, RunRecord, TaskDefinition, TaskRecord, TaskState, WorkflowDefinition } from "../contracts/index.js";
import { validateWorkflow } from "./validate.js";
const terminal = new Set<TaskState>(["completed","failed","cancelled"]);
function deriveRunState(tasks: TaskRecord[]): RunRecord["state"] {
  if(tasks.some(t=>t.state==="failed"||t.state==="blocked"))return "failed";
  if(tasks.every(t=>t.state==="completed"))return "completed";
  if(tasks.some(t=>t.state==="review_required"))return "review_required";
  if(tasks.some(t=>t.state==="running"))return "running";
  if(tasks.every(t=>t.state==="cancelled"||t.state==="completed"))return "cancelled";
  return "pending";
}
/** Immutable state transition; a task cannot run until all dependencies finish and approval is recorded. */
export function transitionTask(workflow: WorkflowDefinition, run: RunRecord, taskId: string, next: TaskState, now: string, approval?: ApprovalRecord): RunRecord {
  validateWorkflow(workflow);
  if(run.workflowId!==workflow.id||run.workflowVersion!==workflow.version)throw new Error("WORKFLOW_RUN_MISMATCH");
  if(!Number.isFinite(Date.parse(now)))throw new Error("INVALID_TIMESTAMP");
  const definition=workflow.tasks.find(t=>t.id===taskId);
  const current=run.tasks.find(t=>t.taskId===taskId);
  if(!definition||!current||terminal.has(current.state))throw new Error("TASK_TRANSITION_DENIED");
  const permitted:Record<TaskState,TaskState[]>={
    pending:["ready","review_required","cancelled"],ready:["running","review_required","cancelled"],
    running:["completed","failed","review_required","cancelled"],review_required:["ready","cancelled"],
    completed:[],failed:[],blocked:["review_required","cancelled"],cancelled:[]
  };
  if(!permitted[current.state].includes(next))throw new Error("TASK_TRANSITION_DENIED");
  const dependenciesComplete=definition.dependsOn.every(id=>run.tasks.find(t=>t.taskId===id)?.state==="completed");
  if(["ready","running","completed"].includes(next)&&!dependenciesComplete)throw new Error("DEPENDENCIES_INCOMPLETE");
  if(next==="running"&&definition.requiresApproval&&!isApproved(approval,run.id,taskId))throw new Error("APPROVAL_REQUIRED");
  if(current.state==="review_required"&&next==="ready"&&!isApproved(approval,run.id,taskId))throw new Error("APPROVAL_REQUIRED");
  const tasks=run.tasks.map(t=>t.taskId===taskId?{...t,state:next,attempt:t.attempt+(next==="running"?1:0)}:t);
  return {...run,tasks,state:deriveRunState(tasks),updatedAt:now};
}
function isApproved(approval:ApprovalRecord|undefined,runId:string,taskId:string):boolean{
  return approval?.state==="approved"&&approval.runId===runId&&approval.taskId===taskId&&!!approval.actorId&&!!approval.decidedAt;
}
/** Promote eligible pending tasks without granting approvals or executing code. */
export function refreshReadyTasks(workflow:WorkflowDefinition,run:RunRecord,now:string):RunRecord{
  let updated=run;
  for(const task of workflow.tasks){
    const record=updated.tasks.find(t=>t.taskId===task.id);
    if(record?.state==="pending"&&task.dependsOn.every(id=>updated.tasks.find(t=>t.taskId===id)?.state==="completed")){
      updated=transitionTask(workflow,updated,task.id,task.requiresApproval?"review_required":"ready",now);
    }
  }
  return updated;
}
