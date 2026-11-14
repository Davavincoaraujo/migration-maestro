/**
 * A deliberately synthetic, read-only transformation preview.
 * The approved mapping and source data must remain in the enterprise environment.
 */
export type FieldKind = "text" | "boolean" | "number";
export interface FieldRule {
  source: string;
  target: string;
  kind: FieldKind;
  required?: boolean;
}
export interface TransformContract {
  schemaVersion: 1;
  mappingId: string;
  fields: FieldRule[];
}
export interface DryRunResult {
  mappingId: string;
  status: "review-required" | "blocked";
  preview: Record<string, string | boolean | number>;
  findings: Array<{ code: string; field: string }>;
  publishable: false;
}
const safeKey = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(s) && !["__proto__", "prototype", "constructor"].includes(s);
export function dryRunTransform(contract: TransformContract, source: Record<string, unknown>): DryRunResult {
  if (!contract || contract.schemaVersion !== 1 || !safeKey(contract.mappingId) || !Array.isArray(contract.fields) || contract.fields.length > 200) throw new Error("Invalid transform contract");
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Invalid source");
  const findings: DryRunResult["findings"] = [];
  const preview: DryRunResult["preview"] = Object.create(null) as DryRunResult["preview"];
  const targets = new Set<string>();
  for (const rule of contract.fields) {
    if (!rule || !safeKey(rule.source) || !safeKey(rule.target) || !["text", "boolean", "number"].includes(rule.kind)) throw new Error("Invalid field rule");
    if (targets.has(rule.target)) throw new Error("Duplicate target field");
    targets.add(rule.target);
    if (!Object.hasOwn(source, rule.source) || source[rule.source] == null) {
      if (rule.required) findings.push({ code: "required-field-missing", field: rule.target });
      continue;
    }
    const value = source[rule.source];
    if ((rule.kind === "text" && typeof value !== "string") ||
        (rule.kind === "boolean" && typeof value !== "boolean") ||
        (rule.kind === "number" && (typeof value !== "number" || !Number.isFinite(value)))) {
      findings.push({ code: "type-mismatch", field: rule.target });
      continue;
    }
    if (typeof value === "string" && value.length > 10000) {
      findings.push({ code: "value-too-long", field: rule.target });
      continue;
    }
    preview[rule.target] = value as string | boolean | number;
  }
  return {
    mappingId: contract.mappingId,
    status: findings.length ? "blocked" : "review-required",
    preview,
    findings,
    publishable: false,
  };
}
