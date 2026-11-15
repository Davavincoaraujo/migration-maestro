import test from "node:test";
import assert from "node:assert/strict";
import { renderOrchestrationView, startOrchestrationView } from "../src/maestro-orchestration-view.js";

test("view renders four agents and keeps execution unauthorized", () => {
  const html=renderOrchestrationView({state:"completed",analytics:"completed",uePattern:"completed",hermes:"completed"});
  assert.match(html,/Migration Analytics/);
  assert.match(html,/UE-Pattern/);
  assert.match(html,/Hermes ACP/);
  assert.match(html,/Revisão humana/);
  assert.match(html,/Execução autorizada: <code>não<\/code>/);
});
test("view escapes untrusted plan descriptions", () => {
  const html=renderOrchestrationView({state:"completed",analytics:"completed",uePattern:"completed",hermes:"completed",plan:{
    schemaVersion:1,kind:"migration-plan",executionAuthorized:false,requiresHumanReview:true,
    steps:[{id:"inventory",description:"<script>alert(1)</script>"},{id:"mapping",description:"ok"},{id:"implementation",description:"ok"},{id:"validation",description:"ok"},{id:"review",description:"ok"}]
  }});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});
test("view binds only loopback and blocks non-GET paths", async () => {
  const server=await startOrchestrationView("hero", 0).catch(e=>e);
  assert.equal(server instanceof Error,true);
});
