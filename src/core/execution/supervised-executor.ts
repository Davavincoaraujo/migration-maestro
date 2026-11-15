import type { ApprovalRecord, AgentDefinition, RunRecord, TaskDefinition, WorkflowDefinition } from "../contracts/index.js";
import { AgentRegistry } from "../agents/registry.js";
import { authorizeTool } from "../policies/authorize.js";
import { refreshReadyTasks, transitionTask } from "../workflow/runtime.js";
export interface ExecutionResult { run: RunRecord; executed: boolean; reason?: string; }
/** Runs at most one task. Caller owns persistence and approval storage. No implicit retries. */
export async function executeOneReadyTask(input:{
 workflow:WorkflowDefinition;run:RunRecord;registry:AgentRegistry;approvals:ApprovalRecord[];
 now:()=>string;worktree?:string;modelId?:string;
}):Promise<ExecutionResult>{
 const {workflow,registry,approvals}=input;
 let run=refreshReadyTasks(workflow,input.run,input.now());
 const ready=workflow.tasks.find(t=>run.tasks.some(r=>r.taskId===t.id&&r.state==="ready"));
 if(!ready)return {run,executed:false,reason:"NO_READY_TASK"};
 const candidates=registry.candidates(ready);
 if(!candidates.length)return {run,executed:false,reason:"NO_CAPABLE_AGENT"};
 const agent=candidates[0];
 const adapter=registry.adapter(agent.id);
 if(!adapter||!(await adapter.checkAvailability()))return {run,executed:false,reason:"AGENT_UNAVAILABLE"};
 const approval=approvals.find(a=>a.runId===run.id&&a.taskId===ready.id&&a.state==="approved"&&a.actorId&&a.decidedAt);
 if(ready.requiresApproval&&!approval)return {run,executed:false,reason:"APPROVAL_REQUIRED"};
 for(const toolId of ready.toolIds){
   const decision=authorizeTool(ready,toolId,registry.toolsFor(ready),run.id,approval);
   if(!decision.allowed)return {run,executed:false,reason:decision.reason};
 }
 run=transitionTask(workflow,run,ready.id,"running",input.now(),approval);
 // Agent execution is an explicit operation; the caller must persist the running state before calling this.
 // This function does not provide crash-safe exactly-once semantics. It must not be used for non-idempotent side effects.
 if(ready.toolIds.some(id=>registry.tool(id)?.effect!=="read"))return {run:input.run,executed:false,reason:"DURABLE_EXECUTION_REQUIRED"};
 try{
   const result=await adapter.execute({runId:run.id,task:ready,modelId:input.modelId,worktree:input.worktree});
   const state=result.status==="completed"?"completed":result.status==="failed"?"failed":"review_required";
   run=transitionTask(workflow,run,ready.id,state,input.now());
   run={...run,tasks:run.tasks.map(t=>t.taskId===ready.id?{...t,agentId:agent.id,modelId:input.modelId,evidenceIds:result.evidenceIds,errorCode:result.errorCode}:t)};
   return {run,executed:true};
 }catch{
   run=transitionTask(workflow,run,ready.id,"failed",input.now());
   return {run,executed:true,reason:"AGENT_EXECUTION_FAILED"};
 }
}
