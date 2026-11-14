import test from "node:test";
import assert from "node:assert/strict";
import { runEvidenceGatedPipeline } from "../src/pipeline/evidence-gated-pipeline.js";
import type { LegacyEvidence } from "../src/analysis/legacy-evidence.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";

const catalog: MetadataCatalog = {
  schemaVersion: 1,
  components: [{ componentId: "model-" + "a".repeat(16), containers: [] }],
  summary: { components: 1, collections: 0, maximumDepth: 0 },
};
const evidence: LegacyEvidence = {
  schemaVersion: 1, pageId: "demo", capturedAt: "2026-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 720 },
  structure: { sections: 1, headings: 1, links: 0, images: 0 },
  checks: { titlePresent: true, descriptionPresent: true, hasH1: true, brokenLinks: 0 },
};
const input = { pageId: "demo", evidence, catalog, sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }] };
test("ready synthetic evidence yields review-only status", () => {
  const result = runEvidenceGatedPipeline(input);
  assert.equal(result.status, "review-required");
  assert.equal(result.publishable, false);
  assert.equal(result.aemWritePerformed, false);
});
test("broken links block review even when mapping succeeds", () => {
  const result = runEvidenceGatedPipeline({ ...input, evidence: { ...evidence, checks: { ...evidence.checks, brokenLinks: 1 } } });
  assert.equal(result.status, "blocked");
  assert.equal(result.migration.status, "review-required");
});
test("mismatched evidence is rejected", () => {
  assert.throws(() => runEvidenceGatedPipeline({ ...input, evidence: { ...evidence, pageId: "another" } }), /does not match/);
});
