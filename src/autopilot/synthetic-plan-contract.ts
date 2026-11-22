import type { SyntheticMappingV1 } from "./synthetic-mapping-contract.js";

/** References are zero-based indexes into the exact hash-bound mapping arrays. */
export interface SyntheticPlanV1 {
  version: 1;
  jobId: string;
  taskId: string;
  stage: "PLAN";
  scope: "synthetic-only";
  corporateReuseVerified: false;
  implementationAuthorized: false;
  mappingFile: "MAP_COMPONENTS.mapping.json";
  mappingDigest: string;
  analyzeResultDigest: string;
  reusedComponents: string[];
  componentsToImplement: string[];
  plannedFiles: string[];
  dependencies: string[];
  risks: string[];
  blockers: string[];
  requirements: SyntheticMappingV1["mapping"];
  semantics: string[];
  responsiveRequirements: string[];
  knownLimitations: string[];
  decisions: { kind: "gap" | "limitation"; index: number; source: string; decision: string; acceptanceCriteria: string[]; testIds: string[] }[];
  implementationPlan: { file: string; steps: string[] };
  acceptanceCriteria: string[];
  proposedTests: { id: string; method: "static" | "browser-manual"; procedure: string; expected: string; status: "proposed" }[];
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 40 && v.every(text);
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2000;
const optionalStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 40 && v.every(text) && new Set(v).size === v.length;
const sameStrings = (v: unknown, expected: string[]) => strings(v) && JSON.stringify(v) === JSON.stringify(expected);
export function validateSyntheticPlan(value: unknown, expected: { jobId: string; taskId: string; mappingDigest: string; mapping: SyntheticMappingV1; implementationFiles?: readonly string[] }): asserts value is SyntheticPlanV1 {
  const p = value as SyntheticPlanV1;
  const m = expected.mapping;
  const files = [...(expected.implementationFiles ?? ["index.html"])];
  const fail = () => { throw Error("INVALID_PLAN_CONTRACT"); };
  if (!p || p.version !== 1 || p.jobId !== expected.jobId || p.taskId !== expected.taskId || p.stage !== "PLAN" ||
      p.scope !== "synthetic-only" || p.corporateReuseVerified !== false || p.implementationAuthorized !== false ||
      p.mappingFile !== "MAP_COMPONENTS.mapping.json" || !/^[a-f0-9]{64}$/.test(p.mappingDigest) || p.mappingDigest !== expected.mappingDigest ||
      p.analyzeResultDigest !== m.analyzeResultDigest || !optionalStrings(p.reusedComponents) || p.reusedComponents.length !== 0 ||
      !sameStrings(p.componentsToImplement, ["semantic-hero"]) || !sameStrings(p.plannedFiles, files) ||
      !optionalStrings(p.dependencies) || !strings(p.risks) || !optionalStrings(p.blockers) ||
      !p.requirements || Object.entries(m.mapping).some(([key, v]) => p.requirements[key as keyof typeof m.mapping] !== v) ||
      !sameStrings(p.semantics, m.semantics) || !sameStrings(p.responsiveRequirements, m.responsiveRequirements) || !sameStrings(p.knownLimitations, m.limitations) ||
      p.implementationPlan?.file !== files[0] || !strings(p.implementationPlan.steps) || !strings(p.acceptanceCriteria) ||
      !Array.isArray(p.proposedTests) || !p.proposedTests.length || p.proposedTests.length > 40 ||
      p.proposedTests.some(t => !t || !/^[a-z][a-z0-9-]{0,63}$/.test(t.id) || !["static", "browser-manual"].includes(t.method) || !text(t.procedure) || !text(t.expected) || t.status !== "proposed") ||
      new Set(p.proposedTests.map(t => t.id)).size !== p.proposedTests.length ||
      !Array.isArray(p.decisions) || p.decisions.length !== m.gaps.length + m.limitations.length) fail();
  const ids = new Set(p.proposedTests.map(t => t.id));
  const refs = new Set<string>();
  for (const d of p.decisions) {
    if (!d || !["gap", "limitation"].includes(d.kind) || !Number.isInteger(d.index) || d.index < 0 || !text(d.source) || d.index >= (d.kind === "gap" ? m.gaps : m.limitations).length ||
        d.source !== (d.kind === "gap" ? m.gaps : m.limitations)[d.index] || !text(d.decision) ||
        !strings(d.acceptanceCriteria) || !strings(d.testIds) || d.testIds.some(id => !ids.has(id)) || new Set(d.testIds).size !== d.testIds.length) fail();
    const ref = `${d.kind}:${d.index}`;
    if (refs.has(ref)) fail();
    refs.add(ref);
  }
}
export function syntheticPlanInstructions(mappingDigest: string, implementationFiles?: readonly string[]): string {
  const files = [...(implementationFiles ?? ["index.html"])];
  const target = implementationFiles ? "Plan React/Next.js server components, semantic layout and CSS Modules only, without client scripts, external resources, forms or dependencies. The coordinator owns package/config/test files." : "Plan only standalone inline-CSS HTML with lang=en, main/h1 and @media; no scripts, external resources or forms.";
  return `Write PLAN.plan.json with plan contract version:1, jobId/taskId matching this request, stage:PLAN, scope:synthetic-only, corporateReuseVerified:false, implementationAuthorized:false, mappingFile:MAP_COMPONENTS.mapping.json and mappingDigest:${mappingDigest} (SHA-256 of exact mapping bytes). Set analyzeResultDigest to the mapping analyzeResultDigest. Set reusedComponents:[] (no corporate reuse is verified), componentsToImplement:["semantic-hero"], plannedFiles:${JSON.stringify(files)}, dependencies:[<documented dependencies or empty>], risks:[<nonempty concrete risks>], blockers:[<unresolved blockers or empty>]. Read that verified mapping. Copy its mapping object into requirements, semantics and responsiveRequirements verbatim, and limitations verbatim into knownLimitations. Include decisions covering EVERY gaps and limitations entry exactly once: {kind:"gap"|"limitation",index:<zero-based array index>,source:<exact original string>,decision:<concrete approach preserving uncertainty>,acceptanceCriteria:[<nonempty criteria>],testIds:[<references to proposedTests IDs>]}. Include implementationPlan:{file:${JSON.stringify(files[0])},steps:[<concrete nonempty steps>]}, acceptanceCriteria:[<nonempty criteria>] and proposedTests:[{id:<unique lowercase slug>,method:"static"|"browser-manual",procedure:<concrete check>,expected:<expected outcome>,status:"proposed"}]. Preserve exact heading/CTA/#garden, semantic and responsive requirements. ${target} Do not claim proposed tests were executed or corporate reuse verified. Include PLAN.plan.json and PLAN.evidence.json in result.artifacts with exact SHA-256 hashes. Do not create implementation files; IMPLEMENT is not authorized by this plan.`;
}
