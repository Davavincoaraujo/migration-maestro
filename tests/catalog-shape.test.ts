import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCatalogShape } from "../src/integrations/catalog-shape.js";
test("summarizes MCP JSON structure without returning private values", () => {
 const shape = summarizeCatalogShape([{ type: "text", text: JSON.stringify({ results: [{ name: "PRIVATE" }], internalPath: "/secret" }) }]);
 assert.deepEqual(shape, { blocks: 1, jsonBlocks: 1, parsedArrays: 0, parsedObjects: 1, topLevelKeys: ["results"] });
 assert.equal(JSON.stringify(shape).includes("PRIVATE"), false);
});
