import assert from "node:assert/strict";
import { test } from "node:test";
import { createDispatchPreview } from "../src/maestro-agent-dispatch.js";

const ids = ["inventory", "mapping", "implementation", "validation", "review"] as const;
const plan = {
  schemaVersion: 1, kind: "migration-plan",
  steps: ids.map(id => ({ id, description: "Planejar " + id })),
  executionAuthorized: false, requiresHumanReview: true
};
test("dispatch preview assigns each stage without authorizing execution", () => {
  const dispatch = createDispatchPreview(plan);
  assert.deepEqual(dispatch.assignments.map(x => x.agent),
    ["analytics", "ue-pattern", "hermes", "validator", "human-review"]);
  assert.deepEqual(dispatch.assignments[2].dependsOn, ["mapping"]);
  assert.ok(dispatch.assignments.every(x => x.status === "blocked_pending_approval" && !x.executionAuthorized));
  assert.equal(dispatch.gitWritesAuthorized, false);
  assert.equal(dispatch.publishingAuthorized, false);
  assert.equal(dispatch.planDigest.length, 64);
  assert.deepEqual(createDispatchPreview(plan), dispatch);
});
test("dispatch refuses forged authorization and unexpected commands", () => {
  assert.throws(() => createDispatchPreview({ ...plan, executionAuthorized: true }), /PLAN_INVALID/);
  assert.throws(() => createDispatchPreview({ ...plan, shellCommand: "echo hi" }), /PLAN_INVALID/);
});
