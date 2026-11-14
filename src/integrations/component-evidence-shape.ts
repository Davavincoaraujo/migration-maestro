/** Privacy-preserving schema discovery for inspect_component responses. No field values leave memory. */
export interface EvidenceField { name: string; type: string; }
export interface EvidenceShape { format: "object" | "array" | "other" | "missing"; fields: EvidenceField[]; }
const KNOWN_FIELDS = [
  "id", "name", "resourceType", "description", "category", "capabilities", "features",
  "properties", "fields", "dialog", "model", "metadata", "variants", "styles",
  "dependencies", "constraints", "source", "evidence", "usage", "examples",
  "component", "data", "error", "status", "path", "filePath",
] as const;
export function summarizeEvidenceShape(content: unknown[]): EvidenceShape {
  for (const block of content.slice(0, 20)) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type !== "text" || typeof item.text !== "string" || item.text.length > 250000) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(item.text); } catch { continue; }
    if (Array.isArray(parsed)) return { format: "array", fields: [] };
    if (!parsed || typeof parsed !== "object") return { format: "other", fields: [] };
    const record = parsed as Record<string, unknown>;
    const fields = KNOWN_FIELDS.filter(name => Object.prototype.hasOwnProperty.call(record, name))
      .map(name => {
        const value = record[name];
        return { name, type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value };
      });
    return { format: "object", fields };
  }
  return { format: "missing", fields: [] };
}
