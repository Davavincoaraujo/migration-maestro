import { analyzeLegacyEvidence, type LegacyEvidence } from "../analysis/legacy-evidence.js";
import { runSyntheticPipeline, type SyntheticPipelineInput } from "./synthetic-pipeline.js";

export interface EvidenceGatedInput extends SyntheticPipelineInput {
  evidence: LegacyEvidence;
}
export function runEvidenceGatedPipeline(input: EvidenceGatedInput) {
  if (!input || !input.evidence || input.evidence.pageId !== input.pageId) {
    throw new Error("Evidence does not match page");
  }
  const evidence = analyzeLegacyEvidence(input.evidence);
  const migration = runSyntheticPipeline(input);
  const blocked = !evidence.readyForReview || migration.status === "blocked";
  return {
    schemaVersion: 1 as const,
    pageId: input.pageId,
    status: blocked ? "blocked" as const : "review-required" as const,
    evidence,
    migration,
    requiresHumanReview: true as const,
    publishable: false as const,
    aemWritePerformed: false as const,
  };
}
