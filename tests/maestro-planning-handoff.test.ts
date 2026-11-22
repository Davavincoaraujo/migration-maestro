import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlanningHandoff } from "../src/maestro-planning-handoff.js";

const ids = ["inventory", "mapping", "implementation", "validation", "review"] as const;
const plan = {
  schemaVersion: 1, kind: "migration-plan",
  steps: ids.map(id => ({ id, description: "Proposta para " + id })),
  executionAuthorized: false, requiresHumanReview: true
};
test("handoff creates dependency-ordered review-only tasks", () => {
  const result = createPlanningHandoff(plan);
  assert.equal(result.tasks.length, 5);
  assert.deepEqual(result.tasks[0].dependsOn, []);
  assert.deepEqual(result.tasks[4].dependsOn, ["validation"]);
  assert.ok(result.tasks.every(t => t.status === "awaiting_human_review" && t.codeExecutionAuthorized === false));
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.planDigest.length, 64);
  assert.deepEqual(createPlanningHandoff(plan), result);
});
test("handoff rejects authorization forged by Hermes", () => {
  assert.throws(() => createPlanningHandoff({ ...plan, executionAuthorized: true }), /PLAN_INVALID/);
});
test("handoff rejects missing steps and unexpected fields", () => {
  assert.throws(() => createPlanningHandoff({ ...plan, steps: [] }), /PLAN_INVALID/);
  assert.throws(() => createPlanningHandoff({ ...plan, command: "echo unsafe" }), /PLAN_INVALID/);
});
