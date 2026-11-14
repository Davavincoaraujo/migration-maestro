import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCheckpointStore } from "../src/autopilot/checkpoint-runner.js";
import { createSyntheticAgentHandlers, executeLocalAgentGraph } from "../src/orchestration/local-agent-executor.js";

test("executes five synthetic agents and stops before mandatory human review", async () => {
  const store = new MemoryCheckpointStore();
  const events: string[] = [];
  const result = await executeLocalAgentGraph("demo", { page: "synthetic" }, createSyntheticAgentHandlers(), store, undefined, event => events.push(event.agentId));
  assert.deepEqual(result.completedAgents, ["discovery", "evidence", "mapping", "composition", "quality"]);
  assert.deepEqual(events, result.completedAgents);
  assert.equal(result.status, "awaiting-review");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.aemWritePerformed, false);
  assert.deepEqual(result.outputs.quality, { reviewed: true, publishable: false });
  const secondEvents: string[] = [];
  const again = await executeLocalAgentGraph("demo", { page: "synthetic" }, createSyntheticAgentHandlers(), store, undefined, event => secondEvents.push(event.stage));
  assert.deepEqual(again.completedAgents, result.completedAgents);
  assert.deepEqual(secondEvents, ["checkpoint-reused"]);
});

test("rejects missing handlers and invalid identifiers", async () => {
  const store = new MemoryCheckpointStore();
  await assert.rejects(executeLocalAgentGraph("../secret", {}, createSyntheticAgentHandlers(), store));
  await assert.rejects(executeLocalAgentGraph("demo", {}, { discovery: async () => ({}) }, store));
});

test("retries only failed agent and preserves completed dependencies", async () => {
  const store = new MemoryCheckpointStore();
  let evidenceRuns = 0;
  let mappingRuns = 0;
  const handlers = {
    ...createSyntheticAgentHandlers(),
    evidence: async () => { evidenceRuns++; return { verified: true }; },
    mapping: async () => { mappingRuns++; if (mappingRuns === 1) throw new Error("temporary"); return { mapped: true }; },
  };
  await assert.rejects(executeLocalAgentGraph("retry", {}, handlers, store));
  const result = await executeLocalAgentGraph("retry", {}, handlers, store);
  assert.equal(evidenceRuns, 1);
  assert.equal(mappingRuns, 2);
  assert.equal(result.status, "awaiting-review");
});

test("rejects changed input against persisted checkpoint", async () => {
  const store = new MemoryCheckpointStore();
  await executeLocalAgentGraph("demo", { version: 1 }, createSyntheticAgentHandlers(), store);
  await assert.rejects(executeLocalAgentGraph("demo", { version: 2 }, createSyntheticAgentHandlers(), store), /Checkpoint mismatch/);
});
