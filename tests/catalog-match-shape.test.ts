import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMatchShape } from "../src/integrations/catalog-match-shape.js";
test("reports recognized fields without leaking values", () => {
 const input = [{ type: "text", text: JSON.stringify({ matches: [{ id: "PRIVATE", name: "INTERNAL", score: 0.7, path: "/corporate" }] }) }];
 const result = summarizeMatchShape(input);
 assert.deepEqual(result, { matchesType: "array", count: 1, candidateFields: [{ name: "id", type: "string" }, { name: "name", type: "string" }, { name: "score", type: "number" }, { name: "path", type: "string" }] });
 assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("handles missing and nonarray matches", () => {
 assert.equal(summarizeMatchShape([]).matchesType, "missing");
 assert.equal(summarizeMatchShape([{ type: "text", text: '{"matches":{}}' }]).matchesType, "object");
});
