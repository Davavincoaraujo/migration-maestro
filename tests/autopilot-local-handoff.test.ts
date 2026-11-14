import test from "node:test";
import assert from "node:assert/strict";
import { validateHandoffTask } from "../src/integrations/autopilot-local-handoff.js";
import { createTaskPacket } from "../src/integrations/autopilot-task-packet.js";
import type { CompatibilityAssessment } from "../src/integrations/component-compatibility.js";
import type { UeValidationGate } from "../src/integrations/ue-validation-gate.js";
const compat: CompatibilityAssessment = { decision: "adapt_candidate", status: "review_required", required: 3, matched: 2, missing: 1, unsupportedEvidence: false };
const gate: UeValidationGate = { status: "review_required", validation: "passed_with_warnings", cliSucceeded: true, humanApprovalRequired: true, errors: 0, warnings: 4, infos: 1 };
test("accepts safe task packet", () => {
 assert.equal(validateHandoffTask(createTaskPacket(compat, gate, true)).task, "adapt_component");
});
test("rejects forged execution permission and unknown schema", () => {
 const p = createTaskPacket(compat, gate, true);
 assert.throws(() => validateHandoffTask({ ...p, execution: { ...p.execution, authorized: true } }), /INVALID_TASK_PACKET/);
 assert.throws(() => validateHandoffTask({ ...p, schemaVersion: 2 }), /INVALID_TASK_PACKET/);
 assert.throws(() => validateHandoffTask({ ...p, execution: { ...p.execution, repositoryWrite: true } }), /INVALID_TASK_PACKET/);
});
