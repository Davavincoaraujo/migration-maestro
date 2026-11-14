import { fetchAnalystCatalogLocal, type CatalogRequest } from "./local-analyst-catalog.js";
import { buildMatchingPlan } from "./component-matching-engine.js";
import { summarizeEvidenceShape, type EvidenceShape } from "./component-evidence-shape.js";

type Fetcher = (directory: string | undefined, request: CatalogRequest) => Promise<{ content: unknown[] }>;
export interface EvidenceInspectionReport {
  status: "review_required";
  discovered: number;
  attempted: number;
  failed: number;
  evidenceShapes: EvidenceShape[];
  nextAction: "define_compatibility_rules";
}
/** Inspects a bounded candidate set; returns only structural field names and types. */
export async function inspectCandidateEvidenceShapes(
  directory: string | undefined, query: string, fetcher: Fetcher = fetchAnalystCatalogLocal,
): Promise<EvidenceInspectionReport> {
  const catalog = await fetcher(directory, { tool: "search_component_catalog", query, limit: 5 });
  const candidates = buildMatchingPlan(catalog.content).candidates.slice(0, 3);
  const evidenceShapes: EvidenceShape[] = [];
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await fetcher(directory, { tool: "inspect_component", idOrName: candidate.id });
      const shape = summarizeEvidenceShape(result.content);
      if (shape.format === "missing") failed++;
      evidenceShapes.push(shape);
    } catch {
      failed++;
      evidenceShapes.push({ format: "missing", fields: [] });
    }
  }
  return { status: "review_required", discovered: buildMatchingPlan(catalog.content).candidates.length,
    attempted: candidates.length, failed, evidenceShapes, nextAction: "define_compatibility_rules" };
}
