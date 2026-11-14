import test from "node:test";
import assert from "node:assert/strict";
import { buildAutopilotAdvisoryPlan } from "../src/integrations/autopilot-advisory-plan.js";
import type { CompatibilityAssessment } from "../src/integrations/component-compatibility.js";
import type { UeValidationGate } from "../src/integrations/ue-validation-gate.js";
const compat: CompatibilityAssessment = { decision: "adapt_candidate", status: "review_required", required: 3, matched: 2, missing: 1, unsupportedEvidence: false };
const ue: UeValidationGate = { status: "review_required", validation: "passed_with_warnings", cliSucceeded: true, humanApprovalRequired: true, errors: 0, warnings: 4, infos: 1 };
test("partial match and UE warnings produce review-only adaptation", () => {
 const p = buildAutopilotAdvisoryPlan(compat, ue);
 assert.equal(p.decision, "adapt"); assert.equal(p.nextAction, "review_adaptation");
 assert.equal(p.codeExecutionAuthorized, false); assert.equal(p.candidateAssociation, "unverified");
});
test("full match still cannot authorize execution", () => {
 const p = buildAutopilotAdvisoryPlan({ ...compat, decision: "reuse_candidate", matched: 3, missing: 0 }, { ...ue, validation: "passed", warnings: 0 });
 assert.equal(p.decision, "reuse_review"); assert.equal(p.humanApprovalRequired, true);
});
test("unknown UE status or errors forces investigation", () => {
 for (const validation of ["unverified", "blocked", "failed"] as const) {
  const p = buildAutopilotAdvisoryPlan(compat, { ...ue, validation });
  assert.equal(p.decision, "investigate");
 }
 assert.equal(buildAutopilotAdvisoryPlan(compat, { ...ue, errors: 1 }).decision, "investigate");
 assert.equal(buildAutopilotAdvisoryPlan({ ...compat, unsupportedEvidence: true }, ue).decision, "investigate");
});
