import type { PageCompositionPlan } from "../planning/page-composition.js";

export interface SimulatedPatternResult {
  pageId: string;
  accepted: boolean;
  proposedComponents: number;
  simulated: true;
  aemWritePerformed: false;
}
/** Mock ue-pattern executor: validates the plan but never connects to AEM. */
export function simulateUePattern(plan: PageCompositionPlan): SimulatedPatternResult {
  if (plan.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(plan.pageId) ||
      !Array.isArray(plan.components) || !Array.isArray(plan.findings) ||
      plan.publishable !== false) throw new Error("Invalid plan");
  return {
    pageId: plan.pageId,
    accepted: plan.status === "review-required" && plan.findings.length === 0,
    proposedComponents: plan.components.length,
    simulated: true,
    aemWritePerformed: false,
  };
}
