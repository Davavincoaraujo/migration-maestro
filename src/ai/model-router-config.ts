import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdaptiveProfile, Provider } from "./model-router.js";

export interface ModelProfileRule { provider: Provider; profile: AdaptiveProfile; modelPatterns: string[]; }
export interface VerifiedModelPrice { provider: Provider; modelId: string; billingMode: "api"; inputPerMillionUsd: number; outputPerMillionUsd: number; sourceUrl: string; verifiedAt: string; }
export interface ModelRouterConfig {
  version: 1;
  profiles: ModelProfileRule[];
  capabilitiesByAgent: Record<string, string[]>;
  prices: VerifiedModelPrice[] | null;
  sessionBilling?: Record<string, { provider: Provider; modelId: string; billingMode: "api"; evidence: string }>;
  usageMetrics: null;
  availabilityRule: string;
}

export function validateModelRouterConfig(value: unknown): ModelRouterConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MODEL_ROUTER_CONFIG");
  const config = value as ModelRouterConfig;
  if (config.version !== 1 || !Array.isArray(config.profiles) || config.profiles.length > 50 ||
    !config.capabilitiesByAgent || typeof config.capabilitiesByAgent !== "object" || Array.isArray(config.capabilitiesByAgent) ||
    (config.prices !== null && (!Array.isArray(config.prices) || config.prices.length > 100)) || config.usageMetrics !== null || typeof config.availabilityRule !== "string") throw new Error("INVALID_MODEL_ROUTER_CONFIG");
  for (const price of config.prices ?? []) {
    if (!price || !["codex", "claude-code"].includes(price.provider) || price.billingMode !== "api" ||
        !/^[a-zA-Z0-9._-]{1,100}$/.test(price.modelId) || ![price.inputPerMillionUsd, price.outputPerMillionUsd].every(n => Number.isFinite(n) && n >= 0) ||
        !/^https:\/\//.test(price.sourceUrl) || !Number.isFinite(Date.parse(price.verifiedAt))) throw Error("INVALID_MODEL_PRICE");
  }
  if (config.sessionBilling !== undefined) {
    if (!config.sessionBilling || typeof config.sessionBilling !== "object" || Array.isArray(config.sessionBilling)) throw Error("INVALID_SESSION_BILLING");
    for (const [agent, billing] of Object.entries(config.sessionBilling)) if (!/^[a-zA-Z0-9._ ()-]{1,100}$/.test(agent) || !billing ||
        !["codex", "claude-code"].includes(billing.provider) || billing.billingMode !== "api" || !/^[a-zA-Z0-9._-]{1,100}$/.test(billing.modelId) ||
        typeof billing.evidence !== "string" || !billing.evidence.trim()) throw Error("INVALID_SESSION_BILLING");
  }
  for (const rule of config.profiles) if (!rule || !["codex", "claude-code", "unknown"].includes(rule.provider) ||
    !["ECONOMY", "BALANCED", "ADVANCED"].includes(rule.profile) || !Array.isArray(rule.modelPatterns) || rule.modelPatterns.length > 30 ||
    rule.modelPatterns.some(pattern => typeof pattern !== "string" || !/^[a-zA-Z0-9.*_-]{1,100}$/.test(pattern))) throw new Error("INVALID_MODEL_PROFILE_RULE");
  for (const [agent, capabilities] of Object.entries(config.capabilitiesByAgent)) if (!/^[a-zA-Z0-9._ -]{1,80}$/.test(agent) ||
    !Array.isArray(capabilities) || capabilities.length > 50 || capabilities.some(capability => typeof capability !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(capability))) throw new Error("INVALID_MODEL_CAPABILITY_RULE");
  return config;
}

export async function readModelRouterConfig(file = resolve("config/model-router.json")): Promise<ModelRouterConfig> {
  return validateModelRouterConfig(JSON.parse(await readFile(file, "utf8")));
}

export function configuredModelProfile(provider: Provider, modelId: string, config: ModelRouterConfig): AdaptiveProfile | "UNKNOWN" {
  const escaped = (pattern: string) => new RegExp("^" + pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  const matches = config.profiles.filter(rule => rule.provider === provider && rule.modelPatterns.some(pattern => escaped(pattern).test(modelId)));
  if (matches.length !== 1) return "UNKNOWN";
  return matches[0].profile;
}
