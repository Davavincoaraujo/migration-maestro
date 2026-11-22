import { discoverInstalledModels } from "./model-discovery.js";
import { findRateLimitedProvider, inspectMaestriModelSessions, routeMaestriStage } from "./maestri-model-router.js";
import { maestriTransport, type MaestriTransport } from "./maestri-central-cli.js";
import { readModelRouterConfig } from "../ai/model-router-config.js";

/** Read-only inspection. Catalog discovery survives an unavailable Maestri connection.
 * A CLI model catalog never becomes an executable session or proof of entitlement.
 */
export async function inspectModelRouter(options: {
  discover?: typeof discoverInstalledModels;
  transport?: MaestriTransport;
} = {}) {
  const transport = options.transport ?? maestriTransport();
  const [catalog, connection] = await Promise.all([
    (options.discover ?? discoverInstalledModels)(),
    transport("list", []).then(listing => ({ listing, connected: true as const }))
      .catch(() => ({ listing: "", connected: false as const })),
  ]);
  const modelConfig = await readModelRouterConfig();
  const registry = connection.connected
    ? await inspectMaestriModelSessions(transport, connection.listing, modelConfig)
    : { sessions: [], candidates: [] };
  const routes = ["ANALYZE", "MAP_COMPONENTS", "PLAN", "IMPLEMENT", "VALIDATE"].map(stage => {
    const failedProvider = findRateLimitedProvider(registry.sessions, stage, modelConfig);
    return { stage, ...routeMaestriStage(stage, registry.candidates, failedProvider ? { priorFailure: "rate_limit", failedProvider } : {}) };
  });
  return {
    discoveredAt: new Date().toISOString(),
    maestri: { state: connection.connected ? "connected" : "unavailable", diagnostic: connection.connected ? null : "MAESTRI_IPC_UNAVAILABLE" },
    providerCatalogs: {
      codex: { state: catalog.codex.state, cliListedModels: catalog.codex.models.map(({ id, displayName, profile, supportedEffort }) => ({ id, displayName, profile, supportedEffort })), entitlement: "not established by the CLI catalog", prices: null, usageMetrics: null },
      claudeCode: { state: catalog.claude.state, cliListedAliases: catalog.claude.models.map(({ id, displayName, profile }) => ({ id, displayName, profile })), entitlement: "not established by CLI help", prices: null, usageMetrics: null },
    },
    connectedMaestriSessions: registry.sessions,
    routeDecisions: routes,
  };
}
