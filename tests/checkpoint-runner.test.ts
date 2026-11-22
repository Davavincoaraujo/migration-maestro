import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCheckpointStore, runCheckpointed, type PipelineStep } from "../src/autopilot/checkpoint-runner.js";

test("pause saves the completed stage and resumes the same full pipeline without replay", async () => {
  const store = new MemoryCheckpointStore();
  const calls: string[] = [];
  const steps = ["analyze", "map-components"].map(id => ({ id, run: async () => { calls.push(id); return { id }; } }));
  const jobId = "d".repeat(20);
  const paused = await runCheckpointed(jobId, {}, steps, store, undefined, { pauseAfter: "analyze" });
  assert.equal(paused.state, "running");
  assert.deepEqual(paused.completed, ["analyze"]);
  assert.deepEqual(await runCheckpointed(jobId, {}, steps, store, undefined, { pauseAfter: "analyze" }), paused);
  const resumed = await runCheckpointed(jobId, {}, steps, store);
  assert.equal(resumed.state, "awaiting-review");
  assert.deepEqual(calls, ["analyze", "map-components"]);
});
const id = "a".repeat(20);
test("restarts at the failed step, preserving completed stages", async () => {
  const store = new MemoryCheckpointStore();
  let first = 0, second = 0;
  const steps: PipelineStep[] = [
    { id: "discover", run: async () => { first++; return { count: 1 }; } },
    { id: "validate", run: async () => { second++; if (second === 1) throw new Error("synthetic failure"); return { valid: true }; } },
  ];
  await assert.rejects(runCheckpointed(id, { page: 1 }, steps, store), /validate/);
  const resumed = await runCheckpointed(id, { page: 1 }, steps, store);
  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(resumed.state, "awaiting-review");
  assert.deepEqual(resumed.completed, ["discover", "validate"]);
});
test("rejects changed inputs and changed step order", async () => {
  const store = new MemoryCheckpointStore();
  const steps = [{ id: "discover", run: async () => 1 }];
  await runCheckpointed(id, { page: 1 }, steps, store);
  await assert.rejects(runCheckpointed(id, { page: 2 }, steps, store), /mismatch/);
  await assert.rejects(runCheckpointed(id, { page: 1 }, [{ id: "validate", run: async () => 1 }], store), /mismatch/);
});
