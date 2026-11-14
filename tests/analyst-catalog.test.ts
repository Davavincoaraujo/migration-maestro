import test from "node:test";
import assert from "node:assert/strict";
import { validateCatalogRequest } from "../src/integrations/local-analyst-catalog.js";
test("catalog requests validate explicit tool names and bounded inputs", () => {
  assert.deepEqual(validateCatalogRequest({ tool: "search_component_catalog", query: "banner", limit: 5 }), { name: "search_component_catalog", arguments: { query: "banner", limit: 5 } });
  assert.deepEqual(validateCatalogRequest({ tool: "inspect_component", idOrName: "banner" }), { name: "inspect_component", arguments: { idOrName: "banner" } });
  assert.throws(() => validateCatalogRequest({ tool: "search_component_catalog", query: "x", limit: 999 }));
  assert.throws(() => validateCatalogRequest({ tool: "inspect_component", idOrName: "\n" }));
  assert.throws(() => validateCatalogRequest({ tool: "publish_assessment" } as unknown as Parameters<typeof validateCatalogRequest>[0]));
});
