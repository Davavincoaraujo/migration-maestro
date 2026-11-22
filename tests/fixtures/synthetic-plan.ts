import type { SyntheticPlanV1 } from "../../src/autopilot/synthetic-plan-contract.js";
import type { SyntheticMappingV1 } from "../../src/autopilot/synthetic-mapping-contract.js";
export const mapping: SyntheticMappingV1 = {
  version: 1, jobId: "b".repeat(20), taskId: "mapping-task", stage: "MAP_COMPONENTS", scope: "synthetic-only", corporateReuseVerified: false,
  analyzeResultDigest: "a".repeat(64), mapping: { source: "hero", component: "semantic-hero", heading: "Explore the imaginary garden", cta: "Discover the garden", href: "#garden", targetId: "garden" },
  semantics: ["main and h1"], responsiveRequirements: ["No overflow"], gaps: ["No visual specification", "No catalog"], limitations: ["No browser tests"],
};
export function planFixture(taskId: string, mappingDigest: string, m = mapping): SyntheticPlanV1 {
  return {
    version: 1, jobId: m.jobId, taskId, stage: "PLAN", scope: "synthetic-only", corporateReuseVerified: false, implementationAuthorized: false,
    mappingFile: "MAP_COMPONENTS.mapping.json", mappingDigest, analyzeResultDigest: m.analyzeResultDigest, reusedComponents: [], componentsToImplement: ["semantic-hero"], plannedFiles: ["index.html"], dependencies: [], risks: ["Synthetic styling is not a verified visual match"], blockers: [], requirements: { ...m.mapping }, semantics: [...m.semantics], responsiveRequirements: [...m.responsiveRequirements], knownLimitations: [...m.limitations],
    decisions: (["gap", "limitation"] as const).flatMap(kind => (kind === "gap" ? m.gaps : m.limitations).map((source, index) => ({ kind, index, source, decision: "Retain uncertainty; use synthetic defaults and verify later", acceptanceCriteria: ["Unverified assumptions remain documented"], testIds: ["static-hero"] }))),
    implementationPlan: { file: "index.html", steps: ["Create semantic main/h1 and internal garden anchor with inline responsive CSS"] },
    acceptanceCriteria: ["Exact fixture text; no external resources or active content"],
    proposedTests: [{ id: "static-hero", method: "static", procedure: "Inspect heading, CTA, target and media query", expected: "Fixture requirements preserved", status: "proposed" }],
  };
}
