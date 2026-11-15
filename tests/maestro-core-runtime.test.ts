import test from "node:test";
import assert from "node:assert/strict";
import { createRunPlan } from "../src/core/workflow/plan.js";
import { refreshReadyTasks, transitionTask } from "../src/core/workflow/runtime.js";
import { authorizeTool } from "../src/core/policies/authorize.js";
import type { ApprovalRecord, ToolDefinition, WorkflowDefinition } from "../src/core/contracts/index.js";
const now="2026-11-14T00:00:00Z";
const workflow:WorkflowDefinition={id:"generic",version:1,tasks:[
{id:"inspect",label:"Inspect",capability:"read",dependsOn:[],toolIds:["reader"],requiresApproval:false},
{id:"edit",label:"Edit",capability:"coding",dependsOn:["inspect"],toolIds:["editor"],requiresApproval:true}
]};
const approval:ApprovalRecord={id:"approval1",runId:"run1",taskId:"edit",state:"approved",requestedAt:now,decidedAt:now,actorId:"reviewer",evidenceIds:[]};
test("read-only tool allowed and writes denied without approval",()=>{
 const tools=new Map<string,ToolDefinition>([["reader",{id:"reader",adapter:"mcp",effect:"read"}],["editor",{id:"editor",adapter:"cli",effect:"write"}]]);
 assert.equal(authorizeTool(workflow.tasks[0],"reader",tools).allowed,true);
 assert.deepEqual(authorizeTool(workflow.tasks[1],"editor",tools),{allowed:false,reason:"APPROVAL_REQUIRED"});
 assert.equal(authorizeTool(workflow.tasks[1],"editor",tools,approval).allowed,true);
});
test("rejects cross-task and rejected approvals",()=>{
 const tools=new Map<string,ToolDefinition>([["editor",{id:"editor",adapter:"cli",effect:"write"}]]);
 assert.equal(authorizeTool(workflow.tasks[1],"editor",tools,{...approval,taskId:"inspect"}).allowed,false);
 assert.equal(authorizeTool(workflow.tasks[1],"editor",tools,{...approval,state:"rejected"}).allowed,false);
});
test("dependency gate prevents premature editing",()=>{
 const run=createRunPlan(workflow,"run1",now);
 assert.throws(()=>transitionTask(workflow,run,"edit","ready",now,approval),/DEPENDENCIES_INCOMPLETE/);
});
test("approval gates task transition and execution",()=>{
 let run=createRunPlan(workflow,"run1",now);
 run=transitionTask(workflow,run,"inspect","running",now);
 run=transitionTask(workflow,run,"inspect","completed",now);
 run=refreshReadyTasks(workflow,run,now);
 assert.equal(run.tasks[1].state,"review_required");
 assert.throws(()=>transitionTask(workflow,run,"edit","ready",now),/APPROVAL_REQUIRED/);
 run=transitionTask(workflow,run,"edit","ready",now,approval);
 assert.throws(()=>transitionTask(workflow,run,"edit","running",now,{...approval,runId:"other"}),/APPROVAL_REQUIRED/);
 run=transitionTask(workflow,run,"edit","running",now,approval);
 assert.equal(run.tasks[1].attempt,1);
 run=transitionTask(workflow,run,"edit","completed",now);
 assert.equal(run.state,"completed");
});
test("completed tasks cannot be restarted",()=>{
 let run=createRunPlan(workflow,"run1",now);
 run=transitionTask(workflow,run,"inspect","running",now);
 run=transitionTask(workflow,run,"inspect","completed",now);
 assert.throws(()=>transitionTask(workflow,run,"inspect","running",now),/TASK_TRANSITION_DENIED/);
});
