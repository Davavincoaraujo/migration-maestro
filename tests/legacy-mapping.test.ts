import test from "node:test";
import assert from "node:assert/strict";
import { planLegacyMappings } from "../src/planning/legacy-mapping.js";
import { buildMetadataCatalog } from "../src/adapters/metadata-catalog.js";
import { exportLocalMetadata } from "../src/adapters/local-metadata.js";

const metadata = exportLocalMetadata({
  modelId: "example-banner",
  fields: [{ name: "slides", type: "multifield", model: "example-slide" }],
  subItems: [{ id: "example-slide", title: "Slide", containerField: "slides", fields: [] }],
});
const catalog = buildMetadataCatalog([metadata]);
test("matching shape still requires human review", () => {
  const result = planLegacyMappings([{ id: "page_01", collections: 1, maximumDepth: 1 }], catalog);
  assert.equal(result[0].status, "review-required");
  assert.equal(result[0].candidates[0].score, 100);
  assert.ok(!JSON.stringify(result).includes("example-banner"));
});
test("mismatch yields no match instead of guessing", () => {
  const result = planLegacyMappings([{ id: "page_02", collections: 2, maximumDepth: 2 }], catalog);
  assert.equal(result[0].status, "no-match");
  assert.equal(result[0].candidates.length, 0);
});
test("rejects invalid and duplicate source IDs", () => {
  assert.throws(() => planLegacyMappings([{ id: "../private", collections: 0, maximumDepth: 0 }], catalog), /Invalid source/);
  assert.throws(() => planLegacyMappings([{ id: "a", collections: 0, maximumDepth: 0 }, { id: "a", collections: 0, maximumDepth: 0 }], catalog), /Duplicate source/);
});
