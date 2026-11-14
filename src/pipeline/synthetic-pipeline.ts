import type { MetadataCatalog } from "../adapters/metadata-catalog.js";
import { planLegacyMappings, type LegacyStructure } from "../planning/legacy-mapping.js";
import { composePage } from "../planning/page-composition.js";
import { buildJiraHandoff } from "../reporting/jira-handoff.js";
import { simulateUePattern } from "../mcp/ue-pattern-simulator.js";

export interface SyntheticPipelineInput {
  pageId: string;
  sections: LegacyStructure[];
  catalog: MetadataCatalog;
}
export function runSyntheticPipeline(input: SyntheticPipelineInput) {
  if (!input || !Array.isArray(input.sections)) throw new Error("Invalid pipeline input");
  const mappings = planLegacyMappings(input.sections, input.catalog, 20);
  const plan = composePage(input.pageId, mappings, input.catalog);
  const execution = simulateUePattern(plan);
  const handoff = buildJiraHandoff(plan);
  return {
    schemaVersion: 1 as const,
    pageId: input.pageId,
    mappings,
    plan,
    execution,
    handoff,
    status: plan.status,
    requiresHumanReview: true as const,
    aemWritePerformed: false as const,
  };
}
