/** Local read-only agent planning. Never sends MCP/UE raw output or identifiers to Hermes. */
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { runUePatternReadOnly, uePatternConfig } from "./integrations/local-ue-pattern.js";
import { executeHermesPrompt } from "./adapters/hermes/acp-executor.js";

type Stage = "completed" | "failed" | "not_configured";
export type Plan = {
  schemaVersion: 1;
  kind: "migration-plan";
  steps: Array<{ id: "inventory" | "mapping" | "implementation" | "validation" | "review"; description: string }>;
  executionAuthorized: false;
  requiresHumanReview: true;
};
const stepIds = ["inventory", "mapping", "implementation", "validation", "review"] as const;
export function parseAgentPlan(raw: string): Plan {
  if (raw.length > 12000) throw new Error("PLAN_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(raw.trim()); } catch { throw new Error("PLAN_NOT_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PLAN_INVALID");
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).sort().join(",") !== "executionAuthorized,kind,requiresHumanReview,schemaVersion,steps" ||
      obj.schemaVersion !== 1 || obj.kind !== "migration-plan" ||
      obj.executionAuthorized !== false || obj.requiresHumanReview !== true ||
      !Array.isArray(obj.steps) || obj.steps.length !== 5) throw new Error("PLAN_INVALID");
  for (let i = 0; i < stepIds.length; i++) {
    const step = obj.steps[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("PLAN_INVALID");
    const record = step as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "description,id" ||
        record.id !== stepIds[i] || typeof record.description !== "string" ||
        !record.description.trim() || record.description.length > 300 ||
        /[\x00-\x1f]/.test(record.description)) throw new Error("PLAN_INVALID");
  }
  return obj as Plan;
}
export function buildPlanningPrompt(analytics: Stage, uePattern: Stage): string {
  return [
    "Voce e o planejador do Migration Maestro. Nao use ferramentas, arquivos ou comandos.",
    "O conteudo privado dos conectores NAO foi fornecido. Nao invente componentes, URLs ou evidencias.",
    "Status de conectividade MCP: " + analytics + "; UE-Pattern: " + uePattern + ".",
    "Produza apenas JSON valido, sem markdown, com exatamente estas chaves:",
    '{"schemaVersion":1,"kind":"migration-plan","steps":[{"id":"inventory","description":"..."},{"id":"mapping","description":"..."},{"id":"implementation","description":"..."},{"id":"validation","description":"..."},{"id":"review","description":"..."}],"executionAuthorized":false,"requiresHumanReview":true}',
    "Escreva descricoes curtas em portugues. A implementacao e apenas proposta, sem autorizacao para executar."
  ].join("\n");
}
export async function runAgentPlanning(
  query: string,
  deps: {
    analytics: typeof fetchAnalystCatalogLocal;
    ue: typeof runUePatternReadOnly;
    hermes: typeof executeHermesPrompt;
    config: typeof uePatternConfig;
  } = { analytics: fetchAnalystCatalogLocal, ue: runUePatternReadOnly, hermes: executeHermesPrompt, config: uePatternConfig }
): Promise<{ mode: "read-only"; analytics: Stage; uePattern: Stage; hermes: Stage; plan?: Plan; requiresHumanReview: true; executionAuthorized: false }> {
  if (!/^[a-zA-Z0-9 _-]{1,80}$/.test(query) || !query.trim()) throw new Error("INVALID_QUERY");
  let analytics: Stage = "not_configured";
  let uePattern: Stage = "not_configured";
  if (process.env.MAESTRO_ANALYTICS_DIR) {
    try {
      const result = await deps.analytics(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 3 });
      analytics = result.resultReceived && !result.isError ? "completed" : "failed";
    } catch { analytics = "failed"; }
  }
  try {
    const config = deps.config();
    if (config) {
      await deps.ue(config, "buscar", query);
      uePattern = "completed";
    }
  } catch { uePattern = "failed"; }
  // Do not plan from missing evidence. Raw connector results are intentionally discarded.
  if (analytics !== "completed" || uePattern !== "completed")
    return { mode: "read-only", analytics, uePattern, hermes: "not_configured", requiresHumanReview: true, executionAuthorized: false };
  try {
    const result = await deps.hermes(buildPlanningPrompt(analytics, uePattern), "hermes", 120000);
    if (!result.promptCompleted || result.responseTruncated || !result.responseText)
      return { mode: "read-only", analytics, uePattern, hermes: "failed", requiresHumanReview: true, executionAuthorized: false };
    const plan = parseAgentPlan(result.responseText);
    return { mode: "read-only", analytics, uePattern, hermes: "completed", plan, requiresHumanReview: true, executionAuthorized: false };
  } catch {
    return { mode: "read-only", analytics, uePattern, hermes: "failed", requiresHumanReview: true, executionAuthorized: false };
  }
}
