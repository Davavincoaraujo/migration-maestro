import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPacket } from "../src/integrations/autopilot-task-packet.js";
import type { CompatibilityAssessment } from "../src/integrations/component-compatibility.js";
import type { UeValidationGate } from "../src/integrations/ue-validation-gate.js";
const compatibility: CompatibilityAssessment = { decision: "adapt_candidate", status: "review_required", required: 3, matched: 2, missing: 1, unsupportedEvidence: false };
const gate: UeValidationGate = { status: "review_required", validation: "passed_with_warnings", cliSucceeded: true, humanApprovalRequired: true, errors: 0, warnings: 4, infos: 1 };
test("verified candidate gets a non-executable adaptation task", () => {
 const packet = createTaskPacket(compatibility, gate, true);
 assert.equal(packet.task, "adapt_component");
 assert.deepEqual(packet.execution, { authorized: false, repositoryWrite: false, publish: false, humanApprovalRequired: true });
});
test("unverified association blocks task even with valid UE report", () => {
 assert.equal(createTaskPacket(compatibility, gate, false).task, "investigate");
});
test("failed validation and missing evidence block reuse", () => {
 assert.equal(createTaskPacket({ ...compatibility, decision: "reuse_candidate", matched: 3, missing: 0 }, { ...gate, validation: "failed", errors: 1 }, true).task, "investigate");
 assert.equal(createTaskPacket(compatibility, null, true).task, "investigate");
 assert.equal(createTaskPacket({ ...compatibility, unsupportedEvidence: true }, gate, true).task, "investigate");
});
