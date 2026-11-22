import {
  routeAdaptiveTask, type AdaptiveModelCandidate, type AdaptiveRouteDecision,
  type AdaptiveRouteRequest, type FailureKind, type Provider,
} from "../ai/model-router.js";
import { maestriSessionCandidate, parseMaestriSessionMetadata, type MaestriSessionMetadata } from "./model-discovery.js";
import type { MaestriTransport } from "./maestri-central-cli.js";
import { readModelRouterConfig, type ModelRouterConfig } from "../ai/model-router-config.js";

const capabilitiesFor = (agent: string, config: ModelRouterConfig): string[] => {
  const role = Object.keys(config.capabilitiesByAgent).find(name => agent.toLowerCase() === name.toLowerCase() || agent.toLowerCase().startsWith(name.toLowerCase() + " ") || agent.toLowerCase().startsWith(name.toLowerCase() + " ("));
  return role ? config.capabilitiesByAgent[role] : [];
};

export function parseConnectedAgentNames(listing: string): string[] {
  const section = listing.split(/Connected agents:\s*/i)[1]?.split(/Connected portals\b/i)[0] ?? listing;
  return [...new Set([...section.matchAll(/name:\s*"([^"]{1,100})"/g)].map(match => match[1]))];
}

export async function inspectMaestriModelSessions(transport: MaestriTransport, listing: string, modelConfig?: ModelRouterConfig): Promise<{
  sessions: MaestriSessionMetadata[];
  candidates: AdaptiveModelCandidate[];
}> {
  const config = modelConfig ?? await readModelRouterConfig();
  const names = parseConnectedAgentNames(listing);
  const sessions = await Promise.all(names.map(async agentId => {
    try { return parseMaestriSessionMetadata(agentId, await transport("check", [agentId]), config); }
    catch { return { ...parseMaestriSessionMetadata(agentId, "", config), diagnostic: "MAESTRI_SESSION_CHECK_FAILED" as const }; }
  }));
  return { sessions, candidates: sessions.map(session => {
    const candidate = maestriSessionCandidate(session, capabilitiesFor(session.agentId, config));
    // Footer metadata does not establish billing mode. Never apply API rates to
    // a subscription session; a verified per-session billing attestation is needed.
    const billing = config.sessionBilling?.[session.agentId];
    const price = config.prices?.find(p => p.provider === candidate.provider && p.modelId === candidate.modelId);
    if (billing?.provider === candidate.provider && billing.modelId === candidate.modelId && price) return {
      ...candidate, inputPerMillionUsd: price.inputPerMillionUsd, outputPerMillionUsd: price.outputPerMillionUsd, priceVerified: true,
    };
    return candidate;
  }) };
}

export interface RoutedMaestriTask {
  stage: string;
  agentRole: string;
  request: AdaptiveRouteRequest;
}

export const centralStageRoutes: Readonly<Record<string, RoutedMaestriTask>> = {
  DISCOVER_COMPONENTS: { stage: "DISCOVER_COMPONENTS", agentRole: "UE-Pattern", request: { taskType: "discovery", capability: "mapping", signals: { taskKind: "read", affectedFiles: 3, technicalRisk: "medium", reasoningNeed: "medium", confidence: 0.6 } } },
  ANALYZE: { stage: "ANALYZE", agentRole: "Analytics", request: { taskType: "analysis", capability: "analysis", signals: { taskKind: "read", affectedFiles: 1, technicalRisk: "low", reasoningNeed: "low", confidence: 0.9 } } },
  MAP_COMPONENTS: { stage: "MAP_COMPONENTS", agentRole: "UE-Pattern", request: { taskType: "mapping", capability: "mapping", signals: { taskKind: "read", affectedFiles: 3, dependencyCount: 1, technicalRisk: "medium", reasoningNeed: "medium", confidence: 0.6 } } },
  PLAN: { stage: "PLAN", agentRole: "Hermes", request: { taskType: "planning", capability: "planning", signals: { taskKind: "architecture", affectedFiles: 5, dependencyCount: 3, technicalRisk: "high", reasoningNeed: "high", confidence: 0.45 } } },
  IMPLEMENT: { stage: "IMPLEMENT", agentRole: "Hermes", request: { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation", affectedFiles: 8, dependencyCount: 4, technicalRisk: "high", reasoningNeed: "high", confidence: 0.45 } } },
  VALIDATE: { stage: "VALIDATE", agentRole: "Validator", request: { taskType: "validation", capability: "validation", signals: { taskKind: "test", affectedFiles: 2, technicalRisk: "medium", reasoningNeed: "medium", confidence: 0.7 } } },
};

export function routeMaestriStage(
  stage: string,
  candidates: readonly AdaptiveModelCandidate[],
  options: { priorFailure?: FailureKind; failedProvider?: Provider; attempts?: number; request?: Partial<AdaptiveRouteRequest> } = {},
): AdaptiveRouteDecision {
  const task = centralStageRoutes[stage];
  if (!task) throw new Error("UNKNOWN_ROUTED_STAGE");
  return routeAdaptiveTask(candidates, { ...task.request, ...options.request, capability: task.request.capability, taskType: task.request.taskType, preferredAgentId: task.agentRole, priorFailure: options.priorFailure, failedProvider: options.failedProvider, attempts: options.attempts });
}

export function findRateLimitedProvider(sessions: readonly MaestriSessionMetadata[], stage: string, modelConfig: ModelRouterConfig): Provider | undefined {
  const route = centralStageRoutes[stage];
  if (!route) return undefined;
  return sessions.find(session => session.availability === "rate-limited" && capabilitiesFor(session.agentId, modelConfig).includes(route.request.capability))?.provider;
}
