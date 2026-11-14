import type { CompatibilityAssessment } from "./component-compatibility.js";
import type { UeValidationGate } from "./ue-validation-gate.js";
import { buildAutopilotAdvisoryPlan } from "./autopilot-advisory-plan.js";
export interface TaskPacket {
  schemaVersion: 1;
  status: "review_required";
  task: "investigate" | "adapt_component" | "review_reuse";
  prerequisites: readonly string[];
  steps: readonly string[];
  checks: readonly string[];
  execution: { authorized: false; repositoryWrite: false; publish: false; humanApprovalRequired: true };
}
export function createTaskPacket(compatibility: CompatibilityAssessment, gate: UeValidationGate | null, bindingVerified: boolean): TaskPacket {
  const decision = gate && bindingVerified ? buildAutopilotAdvisoryPlan(compatibility, gate).decision : "investigate";
  const task = decision === "adapt" ? "adapt_component" : decision === "reuse_review" ? "review_reuse" : "investigate";
  return {
    schemaVersion: 1, status: "review_required", task,
    prerequisites: [
      "Confirm catalog-to-component identity with local evidence",
      "Review requirement coverage and missing fields",
      "Obtain human approval before any code change",
    ],
    steps: task === "adapt_component"
      ? ["Inspect the existing component and mapping locally", "Design the minimal adaptation", "Review the proposed diff before implementation"]
      : task === "review_reuse"
        ? ["Confirm exact business behavior and component contract", "Review reuse decision before implementation"]
        : ["Resolve missing or invalid binding", "Gather compatibility evidence", "Rerun component-specific UE validation"],
    checks: ["TypeScript typecheck", "Unit tests", "UE pattern validation", "Security and repository policy review"],
    execution: { authorized: false, repositoryWrite: false, publish: false, humanApprovalRequired: true },
  };
}
