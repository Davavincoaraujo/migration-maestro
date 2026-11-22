/** Read-only end-to-end orchestration smoke test. Never forwards private tool output to an agent. */
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { runUePatternReadOnly, uePatternConfig } from "./integrations/local-ue-pattern.js";
import { executeHermesPrompt } from "./adapters/hermes/acp-executor.js";

export type IntegrationStep = { status: "completed" | "failed" | "not_configured"; reason?: string };
export type IntegrationSmokeResult = {
  mode: "read-only";
  analytics: IntegrationStep;
  uePattern: IntegrationStep;
  hermes: IntegrationStep & { promptCompleted: boolean; responseMatched: boolean };
  ready: boolean;
};

export function smokePrompt(_analytics: IntegrationStep, _uePattern: IntegrationStep): string {
  return [
    "Teste de integração do Migration Maestro. Não use ferramentas, não acesse arquivos nem execute comandos.",
    "Este é apenas um teste de resposta literal, sem pedido de relatório ou diagnóstico.",
    "A resposta inteira deve ser somente os caracteres abaixo, sem Markdown, explicação, prefixo ou sufixo:",
    "MAESTRO_INTEGRATION_ACK"
  ].join("\n");
}

export async function runIntegrationSmoke(
  query: string,
  deps: {
    analytics: typeof fetchAnalystCatalogLocal;
    ue: typeof runUePatternReadOnly;
    hermes: typeof executeHermesPrompt;
    config: typeof uePatternConfig;
  } = { analytics: fetchAnalystCatalogLocal, ue: runUePatternReadOnly, hermes: executeHermesPrompt, config: uePatternConfig }
): Promise<IntegrationSmokeResult> {
  if (!/^[a-zA-Z0-9 _-]{1,80}$/.test(query) || !query.trim()) throw new Error("INVALID_SMOKE_QUERY");
  let analytics: IntegrationStep = { status: "not_configured" };
  let uePattern: IntegrationStep = { status: "not_configured" };
  if (process.env.MAESTRO_ANALYTICS_DIR) {
    try {
      const response = await deps.analytics(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 3 });
      // Intentionally discard all MCP response content, including component names.
      analytics = { status: response.resultReceived && !response.isError ? "completed" : "failed" };
    } catch { analytics = { status: "failed", reason: "ANALYTICS_CALL_FAILED" }; }
  }
  try {
    const config = deps.config();
    if (config) {
      await deps.ue(config, "buscar", query);
      // Intentionally discard local UE-Pattern output.
      uePattern = { status: "completed" };
    }
  } catch { uePattern = { status: "failed", reason: "UE_PATTERN_CALL_FAILED" }; }
  let hermes: IntegrationSmokeResult["hermes"] = { status: "failed", promptCompleted: false, responseMatched: false };
  try {
    const response = await deps.hermes(smokePrompt(analytics, uePattern), "hermes", 120000);
    const matched = response.promptCompleted && response.stopReason === "end_turn" && !response.responseTruncated &&
      response.serverRequestsDenied === 0 && response.responseText?.trim() === "MAESTRO_INTEGRATION_ACK";
    hermes = {
      status: matched ? "completed" : "failed",
      promptCompleted: response.promptCompleted,
      responseMatched: matched,
      ...(!matched ? { reason: "HERMES_ACK_MISMATCH" } : {})
    };
  } catch { hermes = { status: "failed", promptCompleted: false, responseMatched: false, reason: "HERMES_CALL_FAILED" }; }
  return { mode: "read-only", analytics, uePattern, hermes,
    ready: analytics.status === "completed" && uePattern.status === "completed" && hermes.status === "completed" };
}
