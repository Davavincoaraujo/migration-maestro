import test from "node:test";
import assert from "node:assert/strict";
import { validateSyntheticMapping } from "../src/autopilot/synthetic-mapping-contract.js";
const expected = { jobId: "a".repeat(20), taskId: "fixture-task", analyzeResultDigest: "b".repeat(64) };
const valid = { ...expected, version: 1, stage: "MAP_COMPONENTS", scope: "synthetic-only", corporateReuseVerified: false,
  mapping: { source: "hero", component: "semantic-hero", heading: "Explore the imaginary garden", cta: "Discover the garden", href: "#garden", targetId: "garden" },
  semantics: ["main/h1"], responsiveRequirements: ["mobile and desktop"], gaps: ["No catalog reuse"], limitations: ["No browser verification"] };
test("synthetic mapping contract rejects identity, version, scope, content and empty requirements", () => {
  validateSyntheticMapping(valid, expected);
  for (const patch of [{ version: 2 }, { jobId: "wrong" }, { taskId: "wrong" }, { analyzeResultDigest: "c".repeat(64) }, { stage: "PLAN" }, { corporateReuseVerified: true }, { scope: "production" }, { semantics: [] }, { responsiveRequirements: [] }, { gaps: [] }, { limitations: [] }, { mapping: { ...valid.mapping, href: "https://example.com" } }, { mapping: { ...valid.mapping, heading: "Changed" } }]) {
    assert.throws(() => validateSyntheticMapping({ ...valid, ...patch }, expected), /INVALID_MAPPING_CONTRACT/);
  }
});
