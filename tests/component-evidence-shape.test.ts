import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEvidenceShape } from "../src/integrations/component-evidence-shape.js";
test("only recognized structural keys are reported", () => {
 const result = summarizeEvidenceShape([{ type: "text", text: JSON.stringify({ id: "PRIVATE", capabilities: ["INTERNAL"], unknownSecret: "/secret", properties: { secret: true } }) }]);
 assert.deepEqual(result, { format: "object", fields: [{ name: "id", type: "string" }, { name: "capabilities", type: "array" }, { name: "properties", type: "object" }] });
 assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("invalid responses return missing", () => { assert.deepEqual(summarizeEvidenceShape([]), { format: "missing", fields: [] }); });
