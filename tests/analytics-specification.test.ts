import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSpecification, buildArtifacts } from "../src/analytics/specification.js";

const fixture = JSON.parse(await readFile(new URL("../examples/analytics-specification.json", import.meta.url), "utf8")) as unknown;
test("native analytics generates requirements, traceability and four editable diagrams", () => {
  const spec = parseSpecification(fixture);
  const result = buildArtifacts(spec);
  assert.equal(result.projectId, "demo_migration");
  assert.deepEqual(result.traceability[1]?.dependsOn, ["REQ_001"]);
  assert.match(result.diagrams.classes, /Page "1" \*-- "0\.\.\*" Component/);
  assert.match(result.diagrams.sequence, /REQ_002/);
  assert.match(result.diagrams.activity, /REQ_001 --> REQ_002/);
  assert.match(result.diagrams.components, /Migration Analytics/);
  assert.deepEqual(spec, parseSpecification(fixture));
});
test("native analytics blocks broken links, duplicates and dependency cycles", () => {
  const original = parseSpecification(fixture);
  assert.throws(() => parseSpecification({ ...original, requirements: [...original.requirements, original.requirements[0]] }), /duplicate requirement/);
  assert.throws(() => parseSpecification({ ...original, relations: [{ ...original.relations[0], to: "Missing" }] }), /relation/);
  assert.throws(() => parseSpecification({ ...original, requirements: original.requirements.map(r => ({
    ...r, dependsOn: r.id === "REQ_001" ? ["REQ_002"] : ["REQ_001"],
  })) }), /cyclic dependency/);
  assert.throws(() => parseSpecification({ ...original, requirements: [{ ...original.requirements[0], entityIds: ["Missing"] }] }), /requirement/);
});
test("analytics diagram labels sanitize Mermaid directives and quotes", () => {
  const spec = parseSpecification(fixture);
  spec.requirements[0].title = 'Title"; click X "https://example.org"';
  const result = buildArtifacts(spec);
  assert.doesNotMatch(result.diagrams.activity, /click X/);
  assert.doesNotMatch(result.diagrams.activity, /https:/);
});
