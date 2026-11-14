import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCheckpointStore } from "../src/autopilot/checkpoint-runner.js";
import { runSyntheticBatch } from "../src/pipeline/batch-orchestrator.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";

const catalog: MetadataCatalog = {
  schemaVersion: 1,
  components: [{ componentId: "model-" + "a".repeat(16), containers: [] }],
  summary: { components: 1, collections: 0, maximumDepth: 0 },
};
test("runs two independent synthetic pages with resumable checkpoints", async () => {
  const store = new MemoryCheckpointStore();
  const jobs = ["page_1", "page_2"].map(id => ({
    id, input: { pageId: id, sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }], catalog },
  }));
  const options = { concurrency: 2, maxJobs: 5 };
  const first = await runSyntheticBatch(jobs, store, options);
  assert.deepEqual(first.map(item => item.status), ["fulfilled", "fulfilled"]);
  for (const item of first) {
    if (item.status !== "fulfilled") throw new Error("Unexpected queue status");
    assert.equal(item.value.state, "awaiting-review");
    assert.deepEqual(item.value.completed, ["map", "compose", "simulate", "handoff"]);
    assert.equal((item.value.outputs.simulate as { aemWritePerformed: boolean }).aemWritePerformed, false);
  }
  const repeated = await runSyntheticBatch(jobs, store, options);
  assert.deepEqual(repeated, first);
});
test("rejects duplicate IDs", async () => {
  const job = { id: "duplicate", input: { pageId: "sample", sections: [], catalog } };
  await assert.rejects(runSyntheticBatch([job, job], new MemoryCheckpointStore(), { concurrency: 2, maxJobs: 5 }), /duplicate/);
});
