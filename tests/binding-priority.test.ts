import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeBoundCandidates } from "../src/integrations/binding-priority.js";
const candidates = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, name: id, score: 5 - i, recommendation: "inspect" as const }));
test("fifth candidate is inspected first when explicitly bound", () => {
 const result = prioritizeBoundCandidates(candidates, { bindings: [{ catalogId: "e", componentPath: "principal/sections/banner/v1" }] });
 assert.deepEqual(result.map(x => x.id), ["e", "a", "b"]);
});
test("multiple linked candidates keep original score order", () => {
 const result = prioritizeBoundCandidates(candidates, { bindings: [
  { catalogId: "d", componentPath: "x/v1" }, { catalogId: "b", componentPath: "y/v1" },
 ] });
 assert.deepEqual(result.map(x => x.id), ["b", "d", "a"]);
});
test("unknown bindings do not change ordering", () => {
 assert.deepEqual(prioritizeBoundCandidates(candidates, { bindings: [{ catalogId: "unknown", componentPath: "x/v1" }] }).map(x => x.id), ["a", "b", "c"]);
});
test("invalid limits fail closed", () => {
 assert.throws(() => prioritizeBoundCandidates(candidates, { bindings: [] }, 0), /INVALID_CANDIDATE_LIMIT/);
});
