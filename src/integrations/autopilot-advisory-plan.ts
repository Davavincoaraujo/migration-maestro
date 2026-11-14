import type { CompatibilityAssessment } from "./component-compatibility.js";
import type { UeValidationGate } from "./ue-validation-gate.js";
export type PlanDecision = "investigate" | "adapt" | "reuse_review";
export interface AdvisoryPlan {
  status: "review_required";
  decision: PlanDecision;
  compatibility: CompatibilityAssessment["decision"];
  ueValidation: UeValidationGate["validation"];
  required: number; matched: number; missing: number;
  ueErrors: number | null; ueWarnings: number | null; ueInfos: number | null;
  candidateAssociation: "unverified";
  humanApprovalRequired: true;
  codeExecutionAuthorized: false;
  nextAction: "investigate_evidence" | "review_adaptation" | "review_reuse";
}
/** An explicit UE path is not proof that the catalog candidate refers to the same component. */
export function buildAutopilotAdvisoryPlan(compatibility: CompatibilityAssessment, gate: UeValidationGate): AdvisoryPlan {
  const safe = gate.cliSucceeded && (gate.validation === "passed" || gate.validation === "passed_with_warnings") &&
    gate.errors === 0 && !compatibility.unsupportedEvidence;
  const decision: PlanDecision = !safe || compatibility.decision === "insufficient_evidence"
    ? "investigate" : compatibility.decision === "adapt_candidate" ? "adapt" : "reuse_review";
  return {
    status: "review_required", decision, compatibility: compatibility.decision, ueValidation: gate.validation,
    required: compatibility.required, matched: compatibility.matched, missing: compatibility.missing,
    ueErrors: gate.errors, ueWarnings: gate.warnings, ueInfos: gate.infos,
    candidateAssociation: "unverified", humanApprovalRequired: true, codeExecutionAuthorized: false,
    nextAction: decision === "investigate" ? "investigate_evidence" : decision === "adapt" ? "review_adaptation" : "review_reuse",
  };
}
