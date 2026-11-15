import test from "node:test";
import assert from "node:assert/strict";
import { createRunPlan } from "../src/core/workflow/plan.js";
import { validateWorkflow } from "../src/core/workflow/validate.js";
import type { WorkflowDefinition } from "../src/core/contracts/index.js";
const sample: WorkflowDefinition = { id:"generic.build",version:1,tasks:[
 {id:"inspect",label:"Inspect inputs",capability:"analysis",dependsOn:[],toolIds:["reader"],requiresApproval:false},
 {id:"implement",label:"Implement",capability:"coding",dependsOn:["inspect"],toolIds:["editor"],requiresApproval:true},
 {id:"review",label:"Review",capability:"review",dependsOn:["implement"],toolIds:[],requiresApproval:true}
]};
test("validates a generic workflow without migration dependencies",()=>{
 assert.equal(validateWorkflow(sample),sample);
});
test("creates a deterministic plan without executing or authorizing tools",()=>{
 const run=createRunPlan(sample,"run-1","2026-11-14T00:00:00Z");
 assert.deepEqual(run.tasks.map(t=>t.state),["ready","pending","pending"]);
 assert.equal(run.tasks[1].attempt,0);
 assert.equal(run.workflowId,"generic.build");
});
test("blocks duplicate task ids",()=>{
 assert.throws(()=>validateWorkflow({...sample,tasks:[sample.tasks[0],sample.tasks[0]]}),/INVALID_TASK/);
});
test("blocks missing dependencies",()=>{
 assert.throws(()=>validateWorkflow({...sample,tasks:[{...sample.tasks[0],dependsOn:["missing"]}]}),/UNKNOWN_DEPENDENCY/);
});
test("blocks dependency cycles",()=>{
 assert.throws(()=>validateWorkflow({...sample,tasks:[{...sample.tasks[0],dependsOn:["implement"]},sample.tasks[1]]}),/CYCLIC_WORKFLOW/);
});
test("root approval stays blocked for review",()=>{
 const run=createRunPlan({id:"approval",version:1,tasks:[{...sample.tasks[0],requiresApproval:true}]},"run-2","2026-11-14T00:00:00Z");
 assert.equal(run.tasks[0].state,"review_required");
 assert.equal(run.state,"review_required");
});
