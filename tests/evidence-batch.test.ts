import test from "node:test";
import assert from "node:assert/strict";
import { MemoryCheckpointStore } from "../src/autopilot/checkpoint-runner.js";
import { runEvidenceBatch } from "../src/pipeline/evidence-batch.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";
import type { LegacyEvidence } from "../src/analysis/legacy-evidence.js";

const catalog: MetadataCatalog = {
  schemaVersion: 1,
  components: [{ componentId: "model-" + "a".repeat(16), containers: [] }],
  summary: { components: 1, collections: 0, maximumDepth: 0 },
};
const evidence: LegacyEvidence = {
  schemaVersion: 1, pageId: "sample", capturedAt: "2026-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 720 },
  structure: { sections: 1, headings: 1, links: 0, images: 0 },
  checks: { titlePresent: true, descriptionPresent: true, hasH1: true, brokenLinks: 0 },
};
test("checkpointed evidence pipeline preserves a quality gate on rerun", async () => {
  const store = new MemoryCheckpointStore();
  const jobs = [{ id: "sample", input: { pageId: "sample", evidence, catalog, sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }] } }];
  const options = { concurrency: 1, maxJobs: 2 };
  const first = await runEvidenceBatch(jobs, store, options);
  const repeated = await runEvidenceBatch(jobs, store, options);
  assert.deepEqual(repeated, first);
  if (first[0].status !== "fulfilled") throw new Error("Unexpected queue failure");
  const gate = first[0].value.outputs["quality-gate"] as { status: string; publishable: boolean };
  assert.equal(gate.status, "review-required");
  assert.equal(gate.publishable, false);
});
test("broken links block the quality gate", async () => {
  const store = new MemoryCheckpointStore();
  const jobs = [{ id: "sample", input: { pageId: "sample", evidence: { ...evidence, checks: { ...evidence.checks, brokenLinks: 2 } }, catalog, sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }] } }];
  const result = await runEvidenceBatch(jobs, store, { concurrency: 1, maxJobs: 2 });
  if (result[0].status !== "fulfilled") throw new Error("Unexpected queue failure");
  assert.equal((result[0].value.outputs["quality-gate"] as { status: string }).status, "blocked");
});
