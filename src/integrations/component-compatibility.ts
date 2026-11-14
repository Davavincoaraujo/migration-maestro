/** Local-only evidence comparison. Never sends catalog or requirement values to remote services. */
export interface SectionRequirements { capabilities: string[]; variants: string[]; fieldTypes: string[]; }
export type CompatibilityDecision = "reuse_candidate" | "adapt_candidate" | "insufficient_evidence";
export interface CompatibilityAssessment {
  decision: CompatibilityDecision;
  status: "review_required";
  required: number;
  matched: number;
  missing: number;
  unsupportedEvidence: boolean;
}
const validStrings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 120);
export function validateRequirements(value: unknown): SectionRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUIREMENTS");
  const r = value as Record<string, unknown>;
  if (!validStrings(r.capabilities) || !validStrings(r.variants) || !validStrings(r.fieldTypes)) throw new Error("INVALID_REQUIREMENTS");
  if (r.capabilities.length + r.variants.length + r.fieldTypes.length === 0) throw new Error("EMPTY_REQUIREMENTS");
  return { capabilities: r.capabilities, variants: r.variants, fieldTypes: r.fieldTypes };
}
function parseEvidence(content: unknown[]): Record<string, unknown> | null {
  for (const block of content.slice(0, 20)) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type !== "text" || typeof b.text !== "string" || b.text.length > 250000) continue;
    try {
      const value: unknown = JSON.parse(b.text);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* invalid block */ }
  }
  return null;
}
function normalize(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("en"); }
function distinct(items: string[]): string[] { return [...new Set(items.map(normalize))]; }
/** Exact normalized equality only: no speculative semantic matching. */
export function assessCompatibility(requirements: SectionRequirements, content: unknown[]): CompatibilityAssessment {
  const req = validateRequirements(requirements);
  const evidence = parseEvidence(content);
  const required = distinct(req.capabilities).length + distinct(req.variants).length + distinct(req.fieldTypes).length;
  const unknown: CompatibilityAssessment = { decision: "insufficient_evidence", status: "review_required", required, matched: 0, missing: required, unsupportedEvidence: true };
  if (!evidence || !validStrings(evidence.capabilities) || !validStrings(evidence.variants) || !Array.isArray(evidence.fields)) return unknown;
  const fields = evidence.fields;
  if (fields.length > 200 || !fields.every(x => x && typeof x === "object" && !Array.isArray(x) && typeof (x as Record<string, unknown>).type === "string")) return unknown;
  const sets = [
    new Set(distinct(evidence.capabilities)),
    new Set(distinct(evidence.variants)),
    new Set(distinct(fields.map(x => (x as { type: string }).type))),
  ];
  const needs = [distinct(req.capabilities), distinct(req.variants), distinct(req.fieldTypes)];
  const matched = needs.reduce((count, group, i) => count + group.filter(item => sets[i].has(item)).length, 0);
  const missing = required - matched;
  const decision: CompatibilityDecision = matched === 0 ? "insufficient_evidence" : missing === 0 ? "reuse_candidate" : "adapt_candidate";
  return { decision, status: "review_required", required, matched, missing, unsupportedEvidence: false };
}
