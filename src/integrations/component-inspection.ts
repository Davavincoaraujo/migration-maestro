import { fetchAnalystCatalogLocal, type CatalogRequest } from "./local-analyst-catalog.js";
import { buildMatchingPlan } from "./component-matching-engine.js";

export type InspectionOutcome = "inspected" | "failed";
export interface InspectionSummary {
  status: "review_required";
  discovered: number;
  attempted: number;
  inspected: number;
  failed: number;
  skipped: number;
  /** No candidate IDs, names, raw catalog payloads or error messages. */
  outcomes: InspectionOutcome[];
}
type Fetcher = (directory: string | undefined, request: CatalogRequest) => Promise<{ content: unknown[] }>;
/** Sequential, bounded and advisory; no writes and no automatic reuse. */
export async function inspectMatchingCandidates(
  directory: string | undefined,
  query: string,
  maxInspections = 3,
  fetcher: Fetcher = fetchAnalystCatalogLocal,
): Promise<InspectionSummary> {
  if (!Number.isInteger(maxInspections) || maxInspections < 1 || maxInspections > 5) throw new Error("ANALYST_INVALID_INSPECTION_LIMIT");
  const catalog = await fetcher(directory, { tool: "search_component_catalog", query, limit: 5 });
  const plan = buildMatchingPlan(catalog.content);
  const selected = plan.candidates.slice(0, maxInspections);
  const outcomes: InspectionOutcome[] = [];
  for (const candidate of selected) {
    try {
      const response = await fetcher(directory, { tool: "inspect_component", idOrName: candidate.id });
      if (!Array.isArray(response.content) || response.content.length === 0) throw new Error("ANALYST_EMPTY_INSPECTION");
      outcomes.push("inspected");
    } catch {
      outcomes.push("failed");
    }
  }
  return {
    status: "review_required",
    discovered: plan.candidates.length,
    attempted: selected.length,
    inspected: outcomes.filter(x => x === "inspected").length,
    failed: outcomes.filter(x => x === "failed").length,
    skipped: plan.candidates.length - selected.length,
    outcomes,
  };
}
