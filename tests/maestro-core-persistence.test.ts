import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/core/execution/file-run-store.js";
import { recoverInterruptedRun } from "../src/core/execution/recover-run.js";
import { createRunPlan } from "../src/core/workflow/plan.js";
import { transitionTask } from "../src/core/workflow/runtime.js";
import type { WorkflowDefinition } from "../src/core/contracts/index.js";
const now="2026-11-14T00:00:00Z";
const workflow:WorkflowDefinition={id:"generic",version:1,tasks:[{id:"inspect",label:"Inspect",capability:"analysis",dependsOn:[],toolIds:[],requiresApproval:false}]};
test("run persists and reloads across store instances",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"maestro-run-"));
 try{
  const run=createRunPlan(workflow,"run1",now);
  await new FileRunStore(dir).save(run);
  assert.deepEqual(await new FileRunStore(dir).load("run1"),run);
  assert.equal(await new FileRunStore(dir).load("missing"),null);
  if(process.platform!=="win32")assert.equal((await stat(join(dir,"run1.json"))).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("rejects traversal and malformed records",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"maestro-run-"));
 try{
  const store=new FileRunStore(dir);
  await assert.rejects(store.load("../secret"),/INVALID_RUN_ID/);
  await assert.rejects(store.save({...createRunPlan(workflow,"run1",now),tasks:[{taskId:"inspect",state:"not-a-state" as never,attempt:0,evidenceIds:[]}]}),/INVALID_RUN_RECORD/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("interrupted execution resumes in human-review state without rerunning",()=>{
 let run=createRunPlan(workflow,"run1",now);
 run=transitionTask(workflow,run,"inspect","running",now);
 const recovered=recoverInterruptedRun(workflow,run,"2026-11-15T00:00:00Z");
 assert.equal(recovered.state,"review_required");
 assert.equal(recovered.tasks[0].state,"review_required");
 assert.equal(recovered.tasks[0].attempt,1);
 assert.equal(recovered.tasks[0].errorCode,"INTERRUPTED_REQUIRES_REVIEW");
});
test("completed run is not restarted during recovery",()=>{
 let run=createRunPlan(workflow,"run1",now);
 run=transitionTask(workflow,run,"inspect","running",now);
 run=transitionTask(workflow,run,"inspect","completed",now);
 assert.deepEqual(recoverInterruptedRun(workflow,run,"2026-11-15T00:00:00Z"),run);
});
