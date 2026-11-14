import test from "node:test";
import assert from "node:assert/strict";
import { discoverRegistry } from "../src/adapters/registry-discovery.js";

const definition = {
  modelId: "internal-banner",
  fields: [{ name: "slides", type: "multifield", model: "internal-slide" }],
  subItems: [{ id: "internal-slide", title: "Private Slide", containerField: "slides", fields: [] }],
};
test("reads registry definitions without loading React modules", () => {
  let called = false;
  const registry = new Map<string, unknown>([["secret/key@v1", { definition, load: () => { called = true; throw new Error("must not run"); } }]]);
  const result = discoverRegistry(registry);
  assert.equal(called, false);
  assert.equal(result.accepted, 1);
  assert.equal(result.catalog.summary.collections, 1);
  assert.ok(!JSON.stringify(result).includes("internal-banner"));
  assert.ok(!JSON.stringify(result).includes("secret/key"));
});
test("reports invalid entries without exposing raw fields", () => {
  const result = discoverRegistry({ privateKey: { definition: { modelId: "sensitive" } } });
  assert.equal(result.rejected, 1);
  assert.equal(result.errors[0].reason, "missing-definition");
  assert.ok(!JSON.stringify(result).includes("sensitive"));
});
test("detects duplicate model IDs", () => {
  assert.throws(() => discoverRegistry(new Map([["a", { definition }], ["b", { definition }]])), /Duplicate component identifier/);
});
