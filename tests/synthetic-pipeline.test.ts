import test from "node:test";
import assert from "node:assert/strict";
import { runSyntheticPipeline } from "../src/pipeline/synthetic-pipeline.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";

test("executes structural plan to review handoff without AEM write", () => {
  const catalog: MetadataCatalog = {
    schemaVersion: 1,
    components: [{ componentId: "model-" + "a".repeat(16), containers: [] }],
    summary: { components: 1, collections: 0, maximumDepth: 0 },
  };
  const output = runSyntheticPipeline({ pageId: "sample", sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }], catalog });
  assert.equal(output.status, "review-required");
  assert.equal(output.plan.components.length, 1);
  assert.equal(output.execution.accepted, true);
  assert.equal(output.aemWritePerformed, false);
  assert.equal(output.requiresHumanReview, true);
});
test("blocks unmatched sections", () => {
  const catalog: MetadataCatalog = { schemaVersion: 1, components: [], summary: { components: 0, collections: 0, maximumDepth: 0 } };
  const output = runSyntheticPipeline({ pageId: "sample", sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }], catalog });
  assert.equal(output.status, "blocked");
  assert.equal(output.execution.accepted, false);
});
