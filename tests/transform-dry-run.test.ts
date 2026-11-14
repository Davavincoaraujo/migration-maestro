import test from "node:test";
import assert from "node:assert/strict";
import { dryRunTransform } from "../src/planning/transform-dry-run.js";

const contract = { schemaVersion: 1 as const, mappingId: "sample", fields: [{ source: "heading", target: "title", kind: "text" as const, required: true }] };
test("previews approved field mapping without publication", () => {
  const result = dryRunTransform(contract, { heading: "Example" });
  assert.equal(result.status, "review-required");
  assert.equal(result.preview.title, "Example");
  assert.equal(result.publishable, false);
});
test("blocks missing required fields", () => {
  const result = dryRunTransform(contract, {});
  assert.equal(result.status, "blocked");
  assert.equal(result.findings[0].code, "required-field-missing");
});
test("blocks type mismatches", () => {
  const result = dryRunTransform(contract, { heading: 5 });
  assert.equal(result.status, "blocked");
});
test("rejects prototype-polluting targets", () => {
  assert.throws(() => dryRunTransform({ ...contract, fields: [{ source: "heading", target: "__proto__", kind: "text" }] }, { heading: "x" }), /Invalid field rule/);
});
