/** Versioned UE-Pattern → Hermes handoff for the isolated synthetic hero only. */
export interface SyntheticMappingV1 {
  version: 1;
  jobId: string;
  taskId: string;
  stage: "MAP_COMPONENTS";
  analyzeResultDigest: string;
  scope: "synthetic-only";
  mapping: { source: "hero"; component: "semantic-hero"; heading: string; cta: string; href: "#garden"; targetId: "garden" };
  semantics: string[];
  responsiveRequirements: string[];
  gaps: string[];
  limitations: string[];
  corporateReuseVerified: false;
}
export function validateSyntheticMapping(value: unknown, expected: { jobId: string; taskId: string; analyzeResultDigest: string }): asserts value is SyntheticMappingV1 {
  const v = value as SyntheticMappingV1;
  const strings = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 20 && x.every(s => typeof s === "string" && s.trim() && s.length <= 2000);
  if (!v || v.version !== 1 || v.jobId !== expected.jobId || v.taskId !== expected.taskId || v.stage !== "MAP_COMPONENTS" ||
      !/^[a-f0-9]{64}$/.test(v.analyzeResultDigest) || v.analyzeResultDigest !== expected.analyzeResultDigest ||
      v.scope !== "synthetic-only" || v.corporateReuseVerified !== false ||
      v.mapping?.source !== "hero" || v.mapping.component !== "semantic-hero" ||
      v.mapping.heading !== "Explore the imaginary garden" || v.mapping.cta !== "Discover the garden" ||
      v.mapping.href !== "#garden" || v.mapping.targetId !== "garden" ||
      !strings(v.semantics) || !strings(v.responsiveRequirements) || !strings(v.gaps) || !strings(v.limitations)) throw Error("INVALID_MAPPING_CONTRACT");
}
export const syntheticMappingInstructions = `Write MAP_COMPONENTS.mapping.json with version:1, jobId and taskId matching this request, stage:MAP_COMPONENTS, scope:synthetic-only, corporateReuseVerified:false. Set analyzeResultDigest to the SHA-256 of the exact ANALYZE.result.json bytes. Include mapping:{source:"hero",component:"semantic-hero",heading:"Explore the imaginary garden",cta:"Discover the garden",href:"#garden",targetId:"garden"}. Include nonempty string arrays semantics, responsiveRequirements, gaps and limitations. These describe a generic semantic composition, never a verified catalog component. Include MAP_COMPONENTS.mapping.json and MAP_COMPONENTS.evidence.json with exact SHA-256 hashes in result.artifacts. Hermes will consume this validated handoff after an operator resumes past the mapping pause.`;
