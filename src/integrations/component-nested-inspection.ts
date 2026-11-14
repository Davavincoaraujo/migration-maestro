import { fetchAnalystCatalogLocal, type CatalogRequest } from "./local-analyst-catalog.js";
import { buildMatchingPlan } from "./component-matching-engine.js";
import { summarizeNestedEvidence, type NestedEvidenceShape } from "./component-nested-evidence.js";
type Fetcher = (directory: string | undefined, request: CatalogRequest) => Promise<{ content: unknown[] }>;
export interface NestedEvidenceReport {
  status: "review_required";
  discovered: number;
  attempted: number;
  failed: number;
  evidence: NestedEvidenceShape[];
  nextAction: "implement_evidence_rules";
}
export async function inspectNestedEvidence(
  directory: string | undefined, query: string, fetcher: Fetcher = fetchAnalystCatalogLocal,
): Promise<NestedEvidenceReport> {
  const catalog = await fetcher(directory, { tool: "search_component_catalog", query, limit: 5 });
  const plan = buildMatchingPlan(catalog.content);
  const evidence: NestedEvidenceShape[] = [];
  let failed = 0;
  for (const candidate of plan.candidates.slice(0, 3)) {
    try {
      const response = await fetcher(directory, { tool: "inspect_component", idOrName: candidate.id });
      const shape = summarizeNestedEvidence(response.content);
      if (shape.format === "missing") failed++;
      evidence.push(shape);
    } catch {
      failed++;
      evidence.push({ format: "missing", arrays: [] });
    }
  }
  return { status: "review_required", discovered: plan.candidates.length, attempted: evidence.length, failed, evidence, nextAction: "implement_evidence_rules" };
}
