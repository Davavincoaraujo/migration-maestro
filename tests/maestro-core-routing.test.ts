import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "../src/core/agents/registry.js";
import { selectModel } from "../src/core/models/router.js";
import type { AgentAdapter,AgentDefinition,ModelDefinition,TaskDefinition } from "../src/core/contracts/index.js";
const task:TaskDefinition={id:"implement",label:"Implement",capability:"coding",dependsOn:[],toolIds:["editor"],requiresApproval:true};
const adapter:AgentAdapter={id:"local",async checkAvailability(){return true;},async execute(){return {status:"review_required",evidenceIds:[]};}};
const agent:AgentDefinition={id:"claude",adapter:"local",capabilities:["coding"],allowedTools:["editor"],preferredModels:["model-a","model-b"]};
test("registry returns only capable agents with approved tool declarations",()=>{
 const registry=new AgentRegistry();
 registry.registerTool({id:"editor",adapter:"local",effect:"write"});
 registry.registerAgent(agent,adapter);
 assert.deepEqual(registry.candidates(task).map(a=>a.id),["claude"]);
 assert.deepEqual(registry.candidates({...task,toolIds:["unknown"]}),[]);
 assert.throws(()=>registry.registerAgent(agent,adapter),/INVALID_AGENT_REGISTRATION/);
});
test("registry rejects unregistered tools",()=>{
 const registry=new AgentRegistry();
 assert.throws(()=>registry.registerAgent(agent,adapter),/INVALID_AGENT_REGISTRATION/);
});
test("model router selects cheapest compatible model under budget",()=>{
 const models:ModelDefinition[]=[
 {id:"model-a",provider:"one",capabilities:["coding"],contextWindow:10000,costPerMillionInputTokensUsd:5,costPerMillionOutputTokensUsd:10},
 {id:"model-b",provider:"two",capabilities:["coding"],contextWindow:10000,costPerMillionInputTokensUsd:1,costPerMillionOutputTokensUsd:2}
 ];
 assert.deepEqual(selectModel({task,agent,models,estimatedInputTokens:1000,reservedOutputTokens:1000,maxEstimatedCostUsd:1}),{modelId:"model-b",estimatedCostUsd:0.003});
 assert.equal(selectModel({task,agent,models,estimatedInputTokens:1000,reservedOutputTokens:1000,maxEstimatedCostUsd:0.001}),null);
});
test("model router never guesses missing prices or context windows",()=>{
 const models:ModelDefinition[]=[{id:"model-a",provider:"one",capabilities:["coding"]}];
 assert.equal(selectModel({task,agent,models,estimatedInputTokens:1000,reservedOutputTokens:1000,maxEstimatedCostUsd:100}),null);
});
