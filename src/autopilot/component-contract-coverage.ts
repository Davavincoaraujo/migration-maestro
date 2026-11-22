type Section = { sourceId: string };
export interface ComponentContractGap {
  sourceId: string;
  reason: string;
  requiredContract: string;
  evidence: string[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Coverage is checked before live contract reads or any implementation dispatch. */
export function componentContractCoverage(inventory: unknown, mapping: unknown): {
  ready: boolean; missingContracts: ComponentContractGap[];
} {
  if (!object(inventory) || !Array.isArray(inventory.sections) || !inventory.sections.length ||
      !object(mapping) || !Array.isArray(mapping.sections)) throw Error("INVALID_MAPPING_COVERAGE");
  const ids = (sections: unknown[]): string[] => {
    if (sections.some(s => !object(s) || !text(s.sourceId))) throw Error("INVALID_MAPPING_COVERAGE");
    const values = (sections as Section[]).map(s => s.sourceId);
    if (new Set(values).size !== values.length) throw Error("DUPLICATE_SOURCE_SECTION");
    return values;
  };
  const sources = new Set(ids(inventory.sections));
  const mapped = new Set(ids(mapping.sections));
  if ([...mapped].some(id => !sources.has(id))) throw Error("UNKNOWN_MAPPING_SOURCE_SECTION");
  const gaps = mapping.gaps ?? [];
  if (!Array.isArray(gaps)) throw Error("INVALID_COMPONENT_CONTRACT_GAP");
  for (const gap of gaps) {
    if (!object(gap) || !text(gap.sourceId) || !text(gap.reason) || !text(gap.requiredContract) ||
        !Array.isArray(gap.evidence) || !gap.evidence.length || !gap.evidence.every(text)) throw Error("INVALID_COMPONENT_CONTRACT_GAP");
  }
  const gapIds = ids(gaps);
  if (gapIds.some(id => !sources.has(id) || mapped.has(id))) throw Error("CONFLICTING_COMPONENT_CONTRACT_GAP");
  const missingContracts = gaps as ComponentContractGap[];
  return {
    ready: mapped.size === sources.size && !missingContracts.length,
    missingContracts: [...missingContracts, ...[...sources].filter(id => !mapped.has(id) && !gapIds.includes(id)).map(sourceId => ({
      sourceId, reason: "Source section has no evidenced component mapping.",
      requiredContract: "Inspect or implement a definition, mapper and exporter contract before mapping this section.",
      evidence: ["Section is present in inventory.json and absent from mapping.json sections and gaps."],
    }))],
  };
}
