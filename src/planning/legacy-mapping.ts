import type { MetadataCatalog } from "../adapters/metadata-catalog.js";
import type { ContainerNode } from "../adapters/container-tree.js";

export interface LegacyStructure {
  id: string; // opaque, non-sensitive local identifier
  collections: number;
  maximumDepth: number;
}
export interface MappingCandidate {
  componentId: string;
  score: number;
  reasons: string[];
}
export interface MappingProposal {
  sourceId: string;
  status: "review-required" | "no-match";
  candidates: MappingCandidate[];
  warnings: string[];
}
function count(nodes: ContainerNode[]): { collections: number; maximumDepth: number } {
  let collections = 0, maximumDepth = 0;
  const walk = (items: ContainerNode[], depth: number): void => {
    for (const node of items) { collections++; maximumDepth = Math.max(maximumDepth, depth); walk(node.children, depth + 1); }
  };
  walk(nodes, 1);
  return { collections, maximumDepth };
}
/**
 * Structural shortlist only. Scores are not semantic confidence.
 * Never auto-approves, writes JCR, or publishes content.
 */
export function planLegacyMappings(
  sources: readonly LegacyStructure[],
  catalog: MetadataCatalog,
  limit = 3,
): MappingProposal[] {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.components)) throw new Error("Invalid catalog");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Invalid candidate limit");
  if (sources.length > 10000) throw new Error("Too many sources");
  const ids = new Set<string>();
  return sources.map(source => {
    if (!source || typeof source.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.id) ||
        !Number.isSafeInteger(source.collections) || source.collections < 0 ||
        !Number.isSafeInteger(source.maximumDepth) || source.maximumDepth < 0 ||
        (source.collections === 0 && source.maximumDepth !== 0) ||
        (source.collections > 0 && (source.maximumDepth < 1 || source.maximumDepth > source.collections))) {
      throw new Error("Invalid source structure");
    }
    if (ids.has(source.id)) throw new Error("Duplicate source identifier");
    ids.add(source.id);
    const candidates = catalog.components.map(component => {
      const shape = count(component.containers);
      const exactCollections = shape.collections === source.collections;
      const exactDepth = shape.maximumDepth === source.maximumDepth;
      const score = (exactCollections ? 50 : 0) + (exactDepth ? 50 : 0);
      const reasons = [
        exactCollections ? "collection-count-match" : "collection-count-differs",
        exactDepth ? "nesting-depth-match" : "nesting-depth-differs",
      ];
      return { componentId: component.componentId, score, reasons };
    }).filter(candidate => candidate.score === 100)
      .sort((a, b) => a.componentId.localeCompare(b.componentId))
      .slice(0, limit);
    return {
      sourceId: source.id,
      status: candidates.length ? "review-required" as const : "no-match" as const,
      candidates,
      warnings: [
        "Structural matches do not establish semantic or business-rule compatibility.",
        "Human approval and an enterprise-side mapping are required before AEM writes.",
      ],
    };
  });
}
