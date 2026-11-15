import test from "node:test";
import assert from "node:assert/strict";
import { buildMigrationPlan } from "../src/integrations/migration-plan.js";
test("builds dependency graph with human approval",()=>{
 const plan=buildMigrationPlan([{type:"text",text:"evidence"}]);
 assert.equal(plan.status,"review_required");
 assert.equal(plan.codeExecutionAuthorized,false);
 assert.equal(plan.published,false);
 assert.equal(plan.tasks[0].status,"completed");
 assert.equal(plan.tasks.find(t=>t.id==="implementation")?.status,"approval_required");
 assert.equal(plan.tasks.find(t=>t.id==="pr")?.status,"approval_required");
 assert.deepEqual(plan.tasks.find(t=>t.id==="qa")?.dependsOn,["implementation"]);
});
test("rejects missing evidence",()=>assert.throws(()=>buildMigrationPlan([]),/EMPTY_ANALYST_EVIDENCE/));
