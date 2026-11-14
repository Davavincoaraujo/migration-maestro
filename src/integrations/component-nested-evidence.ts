/** Structural inspection only: never include catalog values, IDs, names or free-form object keys. */
export const EVIDENCE_ARRAYS = ["capabilities", "fields", "variants", "constraints"] as const;
export type EvidenceArrayName = typeof EVIDENCE_ARRAYS[number];
export interface ArrayShape {
  name: EvidenceArrayName;
  type: "array" | "missing" | "other";
  count: number | null;
  elementTypes: string[];
  /** Only known, non-sensitive schema keys; values never leave this function. */
  elementFields: { name: string; type: string }[];
}
export interface NestedEvidenceShape { format: "object" | "other" | "missing"; arrays: ArrayShape[]; }
const SAFE_KEYS = ["type", "required", "label", "valueType", "fieldType", "componentType", "options", "items", "properties", "defaultValue", "minItems", "maxItems", "min", "max", "description", "category", "kind", "format", "enabled", "supported"] as const;
const kind = (value: unknown): string => Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
export function summarizeNestedEvidence(content: unknown[]): NestedEvidenceShape {
  let parsed: unknown;
  let found = false;
  for (const block of content.slice(0, 20)) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type !== "text" || typeof item.text !== "string" || item.text.length > 250000) continue;
    try { parsed = JSON.parse(item.text); found = true; break; } catch { /* ignore malformed text */ }
  }
  if (!found) return { format: "missing", arrays: [] };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { format: "other", arrays: [] };
  const record = parsed as Record<string, unknown>;
  const arrays: ArrayShape[] = EVIDENCE_ARRAYS.map(name => {
    if (!Object.prototype.hasOwnProperty.call(record, name)) return { name, type: "missing", count: null, elementTypes: [], elementFields: [] };
    const value = record[name];
    if (!Array.isArray(value)) return { name, type: "other", count: null, elementTypes: [], elementFields: [] };
    const elementTypes = [...new Set(value.slice(0, 25).map(kind))].sort();
    const objects = value.slice(0, 25).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    const elementFields = SAFE_KEYS.filter(key => objects.some(obj => Object.prototype.hasOwnProperty.call(obj, key)))
      .map(key => ({ name: key, type: [...new Set(objects.filter(obj => Object.prototype.hasOwnProperty.call(obj, key)).map(obj => kind(obj[key])))].sort().join("|") }));
    return { name, type: "array", count: value.length, elementTypes, elementFields };
  });
  return { format: "object", arrays };
}
