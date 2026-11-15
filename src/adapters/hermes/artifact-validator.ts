export type AgentArtifact = {
  kind: "migration-analysis";
  version: 1;
  summary: string;
  components: string[];
  risks: string[];
  nextSteps: string[];
};

export type ArtifactValidation = {
  valid: boolean;
  reason: "VALID" | "EMPTY_RESPONSE" | "INVALID_JSON" | "INVALID_SCHEMA" | "RESPONSE_TRUNCATED";
  artifact?: AgentArtifact;
};

export function validateAgentArtifact(text: string | undefined, truncated = false): ArtifactValidation {
  if (truncated) return { valid: false, reason: "RESPONSE_TRUNCATED" };
  if (!text?.trim()) return { valid: false, reason: "EMPTY_RESPONSE" };
  let value: unknown;
  try { value = JSON.parse(text.trim()); }
  catch { return { valid: false, reason: "INVALID_JSON" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, reason: "INVALID_SCHEMA" };
  const obj = value as Record<string, unknown>;
  const list = (x: unknown): x is string[] =>
    Array.isArray(x) && x.length <= 30 && x.every(v => typeof v === "string" && v.length > 0 && v.length <= 500);
  if (obj.kind !== "migration-analysis" || obj.version !== 1 ||
      typeof obj.summary !== "string" || !obj.summary.trim() || obj.summary.length > 2000 ||
      !list(obj.components) || !list(obj.risks) || !list(obj.nextSteps) ||
      Object.keys(obj).some(k => !["kind", "version", "summary", "components", "risks", "nextSteps"].includes(k))) {
    return { valid: false, reason: "INVALID_SCHEMA" };
  }
  return { valid: true, reason: "VALID", artifact: obj as AgentArtifact };
}
