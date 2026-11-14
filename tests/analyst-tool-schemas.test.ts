import test from "node:test";
import assert from "node:assert/strict";
import { summarizeInputSchema } from "../src/integrations/local-analyst-mcp.js";
test("schema summary exposes only names, required flags and types", () => {
  const fields = summarizeInputSchema({ properties: { url: { type: "string", description: "secret", default: "private" }, options: { $ref: "#/x" } }, required: ["url"] });
  assert.deepEqual(fields, [{ name: "url", required: true, type: "string" }, { name: "options", required: false, type: "complex" }]);
  assert.equal(JSON.stringify(fields).includes("secret"), false);
});
test("invalid schema does not throw", () => { assert.deepEqual(summarizeInputSchema(null), []); assert.deepEqual(summarizeInputSchema({ properties: [] }), []); });
