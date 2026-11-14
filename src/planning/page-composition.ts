import type { MetadataCatalog } from "../adapters/metadata-catalog.js";
import type { MappingProposal } from "./legacy-mapping.js";

export interface PageCompositionPlan {
  schemaVersion: 1;
  pageId: string;
  status: "review-required" | "blocked";
  components: Array<{ slot: number; componentId: string; sourceId: string }>;
  findings: Array<{ code: string; sourceId: string }>;
  publishable: false;
}
/** Build a synthetic topology-only composition. No content or AEM JCR mapping. */
export function composePage(
  pageId: string,
  proposals: readonly MappingProposal[],
  catalog: MetadataCatalog,
): PageCompositionPlan {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(pageId) || !Array.isArray(proposals) || proposals.length > 200) throw new Error("Invalid page composition request");
  const known = new Set(catalog.components.map(c => c.componentId));
  const components: PageCompositionPlan["components"] = [];
  const findings: PageCompositionPlan["findings"] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (seen.has(proposal.sourceId)) throw new Error("Duplicate source in page composition");
    seen.add(proposal.sourceId);
    const candidates = proposal.candidates.filter((c: MappingProposal["candidates"][number]) => c.score === 100 && known.has(c.componentId));
    if (proposal.status !== "review-required" || candidates.length !== 1 || proposal.candidates.length !== 1) {
      findings.push({ code: candidates.length > 1 || proposal.candidates.length > 1 ? "ambiguous-target" : "missing-target", sourceId: proposal.sourceId });
      continue;
    }
    components.push({ slot: components.length, componentId: candidates[0].componentId, sourceId: proposal.sourceId });
  }
  return {
    schemaVersion: 1,
    pageId,
    status: findings.length ? "blocked" : "review-required",
    components,
    findings,
    publishable: false,
  };
}
