import test from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "../src/adapters/manifest.js";
test("accepts sanitized component manifest", () => {
  const manifest = parseManifest({ schemaVersion: 1, components: [{ resourceType: "demo/components/text", componentName: "Text", source: "src/components/Text.tsx" }] });
  assert.equal(manifest.components[0].componentName, "Text");
});
test("rejects duplicated resourceTypes", () => {
  const entry = { resourceType: "demo/text", componentName: "Text", source: "src/Text.tsx" };
  assert.throws(() => parseManifest({ schemaVersion: 1, components: [entry, entry] }));
});
test("rejects unsupported schemas", () => {
  assert.throws(() => parseManifest({ schemaVersion: 2, components: [] }));
});
