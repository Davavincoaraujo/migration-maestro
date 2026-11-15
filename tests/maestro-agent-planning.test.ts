import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningPrompt, parseAgentPlan, runAgentPlanning } from "../src/maestro-agent-planning.js";

const valid = JSON.stringify({
  schemaVersion: 1, kind: "migration-plan",
  steps: ["inventory","mapping","implementation","validation","review"].map(id => ({id, description:"Revisar etapa"})),
  executionAuthorized:false, requiresHumanReview:true
});

test("Hermes planning prompt contains only connector status", () => {
  const prompt = buildPlanningPrompt("completed", "failed");
  assert.match(prompt, /UE-Pattern: failed/);
  assert.doesNotMatch(prompt, /componentPath|internalUrl|secret/);
});
test("planning accepts strictly validated review-only JSON", () => {
  assert.equal(parseAgentPlan(valid).executionAuthorized, false);
  assert.equal(parseAgentPlan(valid).steps.length, 5);
});
test("planning rejects execution authorization and extra fields", () => {
  assert.throws(() => parseAgentPlan(valid.replace('"executionAuthorized":false','"executionAuthorized":true')), /PLAN_INVALID/);
  assert.throws(() => parseAgentPlan(valid.replace('"kind":"migration-plan"', '"kind":"migration-plan","secret":"value"')), /PLAN_INVALID/);
  assert.throws(() => parseAgentPlan("not json"), /PLAN_NOT_JSON/);
});
test("planning does not call Hermes when a connector is missing", async () => {
  const previous = process.env.MAESTRO_ANALYTICS_DIR;
  delete process.env.MAESTRO_ANALYTICS_DIR;
  try {
    const result = await runAgentPlanning("hero", {
      analytics: async () => { throw Error("unexpected"); },
      ue: async () => { throw Error("unexpected"); },
      config: () => null,
      hermes: async () => { throw Error("unexpected"); }
    });
    assert.equal(result.hermes, "not_configured");
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.plan, undefined);
  } finally {
    if (previous === undefined) delete process.env.MAESTRO_ANALYTICS_DIR;
    else process.env.MAESTRO_ANALYTICS_DIR = previous;
  }
});
