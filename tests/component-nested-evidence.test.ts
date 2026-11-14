import test from "node:test";
import assert from "node:assert/strict";
import { summarizeNestedEvidence } from "../src/integrations/component-nested-evidence.js";
const wrap = (x: unknown) => [{ type: "text", text: JSON.stringify(x) }];
test("reports only safe schema keys and types, never corporate values", () => {
  const result = summarizeNestedEvidence(wrap({ capabilities: ["internal capability"], fields: [{ type: "text", required: true, secretKey: "/private/path", label: "Secret label" }], variants: [], constraints: [{ minItems: 2 }] }));
  assert.equal(result.format, "object");
  assert.equal(result.arrays[0].count, 1);
  assert.deepEqual(result.arrays[1].elementFields, [{ name: "type", type: "string" }, { name: "required", type: "boolean" }, { name: "label", type: "string" }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("Secret"), false);
});
test("missing and nonarray evidence remain unverified", () => {
  const result = summarizeNestedEvidence(wrap({ fields: "invalid" }));
  assert.equal(result.arrays[1].type, "other");
  assert.equal(result.arrays[0].type, "missing");
});
