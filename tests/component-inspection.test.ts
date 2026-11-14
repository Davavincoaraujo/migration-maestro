import test from "node:test";
import assert from "node:assert/strict";
import { inspectMatchingCandidates } from "../src/integrations/component-inspection.js";
import type { CatalogRequest } from "../src/integrations/local-analyst-catalog.js";
test("inspects top candidates sequentially and isolates failures", async () => {
  const called: string[] = [];
  const fetcher = async (_dir: string | undefined, request: CatalogRequest): Promise<{ content: unknown[] }> => {
    called.push(request.tool);
    if (request.tool === "search_component_catalog") return { content: [{ type: "text", text: JSON.stringify({ matches: [
      { id: "a", name: "A", score: 17 }, { id: "b", name: "B", score: 11 }, { id: "c", name: "C", score: 9 },
    ] }) }] };
    if (request.idOrName === "b") throw new Error("PRIVATE_INTERNAL_PATH");
    return { content: [{ type: "text", text: "{}" }] };
  };
  const result = await inspectMatchingCandidates("/local", "banner", 2, fetcher);
  assert.deepEqual(called, ["search_component_catalog", "inspect_component", "inspect_component"]);
  assert.deepEqual(result, { status: "review_required", discovered: 3, attempted: 2, inspected: 1, failed: 1, skipped: 1, outcomes: ["inspected", "failed"] });
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("rejects unbounded inspection requests", async () => {
  await assert.rejects(inspectMatchingCandidates("/local", "banner", 6), /ANALYST_INVALID_INSPECTION_LIMIT/);
});
