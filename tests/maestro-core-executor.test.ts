import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "../src/core/agents/registry.js";
import { executeOneReadyTask } from "../src/core/execution/supervised-executor.js";
import { createRunPlan } from "../src/core/workflow/plan.js";
import type { AgentAdapter, WorkflowDefinition, ApprovalRecord } from "../src/core/contracts/index.js";
const now="2026-11-14T00:00:00Z";
const readWorkflow:WorkflowDefinition={id:"safe",version:1,tasks:[{id:"inspect",label:"Inspect",capability:"analysis",dependsOn:[],toolIds:["reader"],requiresApproval:false}]};
test("executes only a registered read-only adapter",async()=>{
 let called=0;
 const registry=new AgentRegistry();
 registry.registerTool({id:"reader",adapter:"local",effect:"read"});
 const adapter:AgentAdapter={id:"local",async checkAvailability(){return true;},async execute(){called++;return {status:"completed",evidenceIds:["evidence1"]};}};
 registry.registerAgent({id:"analyst",adapter:"local",capabilities:["analysis"],allowedTools:["reader"]},adapter);
 const result=await executeOneReadyTask({workflow:readWorkflow,run:createRunPlan(readWorkflow,"run1",now),registry,approvals:[],now:()=>now});
 assert.equal(called,1);
 assert.equal(result.run.state,"completed");
 assert.deepEqual(result.run.tasks[0].evidenceIds,["evidence1"]);
});
test("never executes write adapters without durable handoff",async()=>{
 let called=0;
 const registry=new AgentRegistry();
 registry.registerTool({id:"editor",adapter:"local",effect:"write"});
 registry.registerAgent({id:"coder",adapter:"local",capabilities:["coding"],allowedTools:["editor"]},{id:"local",async checkAvailability(){return true;},async execute(){called++;return {status:"completed",evidenceIds:[]};}});
 const workflow:WorkflowDefinition={id:"write",version:1,tasks:[{id:"edit",label:"Edit",capability:"coding",dependsOn:[],toolIds:["editor"],requiresApproval:true}]};
 const approval:ApprovalRecord={id:"a1",runId:"run1",taskId:"edit",state:"approved",requestedAt:now,decidedAt:now,actorId:"operator",evidenceIds:[]};
 const run=createRunPlan(workflow,"run1",now);
 const result=await executeOneReadyTask({workflow,run,registry,approvals:[approval],now:()=>now});
 assert.equal(called,0);
 assert.equal(result.reason,"NO_READY_TASK");
});
test("missing agent fails closed without executing",async()=>{
 const registry=new AgentRegistry();
 const result=await executeOneReadyTask({workflow:readWorkflow,run:createRunPlan(readWorkflow,"run1",now),registry,approvals:[],now:()=>now});
 assert.equal(result.executed,false);
 assert.equal(result.reason,"NO_CAPABLE_AGENT");
});
