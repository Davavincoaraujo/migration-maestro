import { validateRequirements, type SectionRequirements } from "./component-compatibility.js";
export interface CapabilityEvidence { capabilities: readonly string[]; variants: readonly string[]; fieldTypes: readonly string[]; }
const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase();
export function planCapabilityCoverage(requirementsValue: unknown, evidence: CapabilityEvidence | null) {
 const req = validateRequirements(requirementsValue);
 const groups = ["capabilities", "variants", "fieldTypes"] as const;
 const matched: Record<string, string[]> = {}, missing: Record<string, string[]> = {};
 for (const key of groups) {
  const known = new Set((evidence?.[key] ?? []).map(normalize));
  matched[key] = req[key].filter(value => known.has(normalize(value)));
  missing[key] = req[key].filter(value => !known.has(normalize(value)));
 }
 const missingCapabilities = missing.capabilities.length;
 const status = !evidence ? "insufficient_evidence" : missingCapabilities > 0 ? "discover_alternatives" : Object.values(missing).some(items => items.length) ? "needs_specification" : "reuse_review";
 return { status, matched, missing, executionReady: false, humanApprovalRequired: true,
  nextAction: status === "discover_alternatives" ? "search_catalog_for_missing_capabilities" : status === "needs_specification" ? "define_exact_variant_or_field_behavior" : status === "reuse_review" ? "verify_business_equivalence" : "inspect_candidate_evidence" };
}
export function ensureExecutableSpecification(requirements: SectionRequirements, specification: unknown): void {
 validateRequirements(requirements);
 if (!specification || typeof specification !== "object" || Array.isArray(specification)) throw new Error("IMPLEMENTATION_SPEC_REQUIRED");
 const spec = specification as Record<string, unknown>;
 if (spec.schemaVersion !== 1 || spec.approved !== true || typeof spec.componentPath !== "string" ||
 !Array.isArray(spec.acceptanceCriteria) || spec.acceptanceCriteria.length === 0 ||
 spec.acceptanceCriteria.length > 30 || !spec.acceptanceCriteria.every(s => typeof s === "string" && s.trim().length >= 12 && s.length <= 500)) throw new Error("INVALID_IMPLEMENTATION_SPEC");
}
