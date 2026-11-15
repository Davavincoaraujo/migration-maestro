import test from "node:test";
import assert from "node:assert/strict";
import { planHermesDemand } from "../src/core/hermes/plan.js";
import type { HermesDemand } from "../src/core/hermes/plan.js";
const demand:HermesDemand={id:"portal",title:"Portal",features:[
 {id:"analysis",title:"Analysis",tasks:[{id:"inspect",title:"Inspect",dependsOn:[]}]},
 {id:"build",title:"Build",dependsOn:["analysis"],tasks:[{id:"code",title:"Code",dependsOn:[]},{id:"test",title:"Test",dependsOn:["code"]}]}
]};
test("Hermes creates deterministic local feature branches and dependent tasks",()=>{
 const plan=planHermesDemand(demand);
 assert.equal(plan.workspace,"local");
 assert.equal(plan.requiresHumanApproval,true);
 assert.deepEqual(plan.features.map(f=>f.branch),["feature/hermes-portal-analysis","feature/hermes-portal-build"]);
 assert.deepEqual(plan.workflow.tasks.find(t=>t.id==="build.code")?.dependsOn,["analysis.inspect"]);
 assert.deepEqual(plan.workflow.tasks.find(t=>t.id==="build.test")?.dependsOn,["build.code","analysis.inspect"]);
 assert.ok(plan.workflow.tasks.every(t=>t.requiresApproval));
});
test("Hermes blocks feature cycles",()=>{
 assert.throws(()=>planHermesDemand({...demand,features:[{...demand.features[0],dependsOn:["build"]},demand.features[1]]}),/CYCLIC_WORKFLOW/);
});
test("Hermes blocks unsafe ids and missing task dependencies",()=>{
 assert.throws(()=>planHermesDemand({...demand,id:"../escape"}),/INVALID_DEMAND/);
 assert.throws(()=>planHermesDemand({...demand,features:[{...demand.features[0],tasks:[{id:"inspect",title:"Inspect",dependsOn:["missing"]}]},demand.features[1]]}),/INVALID_TASK_DEPENDENCY/);
});
