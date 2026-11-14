import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSpecification } from "../src/analytics/specification.js";
import { planAnalyticsHandoff } from "../src/analytics/autopilot-handoff.js";

const fixture = JSON.parse(await readFile(new URL("../examples/analytics-specification.json", import.meta.url), "utf8")) as unknown;

test("analytics handoff is deterministic, dependency ordered and human gated", () => {
  const spec = parseSpecification(fixture);
  const a = planAnalyticsHandoff(spec);
  const b = planAnalyticsHandoff(spec);
  assert.deepEqual(a, b);
  assert.equal(a.status, "awaiting-human-review");
  assert.equal(a.requiresHumanReview, true);
  assert.equal(a.allowExternalWrites, false);
  assert.equal(a.aemWritePerformed, false);
  assert.match(a.specificationDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(a.items.map(i => i.requirementId), ["REQ_001", "REQ_002"]);
  assert.deepEqual(a.items[1].dependsOn, [a.items[0].id]);
  assert.equal(a.items[1].status, "blocked");
  assert.deepEqual(a.items[0].acceptanceCriteria, spec.requirements[0].acceptanceCriteria);
  assert.deepEqual(a.items[0].proposedAgents, ["mapping", "composition", "quality"]);
});

test("analytics handoff is immutable from source and rejects invalid requirements", () => {
  const spec = parseSpecification(fixture);
  const handoff = planAnalyticsHandoff(spec);
  spec.requirements[0].title = "Changed after planning";
  assert.notEqual(handoff.items[0].title, spec.requirements[0].title);
  assert.notEqual(planAnalyticsHandoff(spec).specificationDigest, handoff.specificationDigest);
  assert.throws(() => planAnalyticsHandoff({ ...spec, requirements: [
    { ...spec.requirements[0], dependsOn: ["MISSING"] },
  ] }), /missing dependency/);
});
