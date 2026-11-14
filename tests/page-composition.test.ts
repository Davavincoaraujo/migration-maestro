import test from "node:test";
import assert from "node:assert/strict";
import { composePage } from "../src/planning/page-composition.js";
import { buildJiraHandoff, toJiraMarkdown } from "../src/reporting/jira-handoff.js";
import type { MetadataCatalog } from "../src/adapters/metadata-catalog.js";
const componentId = "model-" + "a".repeat(16);
const catalog: MetadataCatalog = { schemaVersion: 1, components: [{ componentId, containers: [] }], summary: { components: 1, collections: 0, maximumDepth: 0 } };
test("builds a review-only composition and Jira handoff", () => {
  const plan = composePage("page_01", [{ sourceId: "section_01", status: "review-required", candidates: [{ componentId, score: 100, reasons: [] }], warnings: [] }], catalog);
  assert.equal(plan.status, "review-required");
  assert.equal(plan.components[0].componentId, componentId);
  assert.equal(plan.publishable, false);
  const handoff = buildJiraHandoff(plan);
  assert.match(toJiraMarkdown(handoff), /Human review required/);
});
test("blocks ambiguous mapping", () => {
  const candidate = { componentId, score: 100, reasons: [] };
  const plan = composePage("page_02", [{ sourceId: "section_01", status: "review-required", candidates: [candidate, candidate], warnings: [] }], catalog);
  assert.equal(plan.status, "blocked");
  assert.equal(plan.findings[0].code, "ambiguous-target");
});
