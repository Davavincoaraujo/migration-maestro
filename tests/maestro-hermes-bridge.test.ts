import test from "node:test";
import assert from "node:assert/strict";
import { NousHermesAdapter, probeHermesCli } from "../src/adapters/hermes/cli.js";
test("Hermes bridge checks a local executable without invoking a shell",async()=>{
 assert.equal(await probeHermesCli({executable:process.execPath,args:["--version"]}),true);
});
test("Hermes bridge refuses unsafe command arguments",async()=>{
 await assert.rejects(probeHermesCli({executable:"node",args:["-e","process.exit(0)"]}),/INVALID_HERMES_CONFIG/);
});
test("Hermes adapter never claims an unconfigured execution succeeded",async()=>{
 const adapter=new NousHermesAdapter({executable:process.execPath,args:["--version"]});
 const result=await adapter.execute({runId:"run1",task:{id:"build",label:"Build",capability:"coding",dependsOn:[],toolIds:[],requiresApproval:true}});
 assert.equal(result.status,"review_required");
 assert.equal(result.errorCode,"HERMES_EXECUTION_PROTOCOL_NOT_CONFIGURED");
});
