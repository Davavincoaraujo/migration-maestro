import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCheckpointStore } from "../src/autopilot/file-checkpoint-store.js";
import { runSyntheticBatch } from "../src/pipeline/batch-orchestrator.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";

const catalog: MetadataCatalog = {
  schemaVersion: 1,
  components: [{ componentId: "model-" + "a".repeat(16), containers: [] }],
  summary: { components: 1, collections: 0, maximumDepth: 0 },
};
test("restores a synthetic batch from a new file store instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maestro-checkpoint-"));
  try {
    const jobs = [{ id: "sample", input: { pageId: "sample", sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }], catalog } }];
    const options = { concurrency: 1, maxJobs: 2 };
    const first = await runSyntheticBatch(jobs, new FileCheckpointStore(directory), options);
    const resumed = await runSyntheticBatch(jobs, new FileCheckpointStore(directory), options);
    assert.deepEqual(resumed, first);
    assert.equal(first[0].status, "fulfilled");
    if (first[0].status === "fulfilled") assert.equal(first[0].value.state, "awaiting-review");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejects traversal identifiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maestro-checkpoint-"));
  try {
    await assert.rejects(new FileCheckpointStore(directory).get("../secrets"), /Invalid checkpoint ID/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
