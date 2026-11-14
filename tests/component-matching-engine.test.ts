import test from "node:test";
import assert from "node:assert/strict";
import { buildMatchingPlan, summarizeMatchingPlan } from "../src/integrations/component-matching-engine.js";
const block = (matches: unknown[]) => [{ type: "text", text: JSON.stringify({ matches }) }];
test("orders catalog candidates and requires review", () => {
 const plan = buildMatchingPlan(block([{ id: "b", name: "B", score: 0.4 }, { id: "a", name: "A", score: 0.8 }, { id: "a", name: "A", score: 0.6 }]));
 assert.equal(plan.status, "review_required");
 assert.deepEqual(plan.candidates.map(c => c.id), ["a", "b"]);
 assert.ok(plan.candidates.every(c => c.recommendation === "inspect"));
 assert.deepEqual(summarizeMatchingPlan(plan).scoreRange, { min: 0.4, max: 0.8 });
});
test("rejects invalid records without promoting candidates", () => {
 const plan = buildMatchingPlan(block([{ id: "x", name: "X", score: "high" }, { id: "y", name: "Y", score: 1 }]));
 assert.equal(plan.rejectedRecords, 1);
 assert.equal(plan.candidates.length, 1);
 assert.equal(plan.status, "review_required");
});
