import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyExecutionFailure, classifyTask, routeAdaptiveTask, shouldEscalateModel,
  type AdaptiveModelCandidate,
} from "../src/ai/model-router.js";
import { parseClaudeModelAliases, parseCodexModelCatalog, parseMaestriSessionMetadata } from "../src/integrations/model-discovery.js";
import { parseConnectedAgentNames, routeMaestriStage } from "../src/integrations/maestri-model-router.js";
import { readModelRouterConfig } from "../src/ai/model-router-config.js";

const candidates: AdaptiveModelCandidate[] = [
  { id: "codex-luna", provider: "codex", modelId: "gpt-6-luna", profile: "ECONOMY", capabilities: ["analysis", "mapping", "coding", "review"], availability: "available", source: "maestri-session" },
  { id: "codex-sol", provider: "codex", modelId: "gpt-6.1-sol", profile: "BALANCED", capabilities: ["analysis", "mapping", "coding", "review"], availability: "available", source: "maestri-session" },
  { id: "codex-astra", provider: "codex", modelId: "gpt-6-astra", profile: "ADVANCED", capabilities: ["analysis", "mapping", "coding", "review"], availability: "available", source: "maestri-session" },
  { id: "claude-sonnet", provider: "claude-code", modelId: "sonnet", profile: "BALANCED", capabilities: ["analysis", "mapping", "coding", "review"], availability: "available", source: "maestri-session" },
  { id: "claude-opus", provider: "claude-code", modelId: "opus", profile: "ADVANCED", capabilities: ["analysis", "mapping", "coding", "review"], availability: "available", source: "maestri-session" },
];

test("a scoped simple task selects ECONOMY", () => {
  const route = routeAdaptiveTask(candidates, { taskType: "analysis", capability: "analysis", signals: { taskKind: "read", affectedFiles: 1, technicalRisk: "low", reasoningNeed: "low" } });
  assert.equal(route.action, "agent");
  assert.equal(route.profile, "ECONOMY");
  assert.equal(route.modelId, "gpt-6-luna");
});

test("verified estimated total cost outranks the preferred role without inventing token usage", () => {
  const priced: AdaptiveModelCandidate[] = [
    { ...candidates[1], id: "Hermes", inputPerMillionUsd: 10, outputPerMillionUsd: 20, priceVerified: true },
    { ...candidates[3], id: "Hermes alternate", inputPerMillionUsd: 1, outputPerMillionUsd: 2, priceVerified: true },
  ];
  const route = routeAdaptiveTask(priced, { taskType: "implementation", capability: "coding", preferredAgentId: "Hermes", signals: { taskKind: "implementation", technicalRisk: "medium" }, estimatedInputTokens: 1000, reservedOutputTokens: 500 });
  assert.equal(route.agentId, "Hermes alternate");
  assert.equal(route.estimatedCostUsd, 0.002);
  assert.equal(route.usage.inputTokens, null);
});

test("a moderate implementation selects BALANCED", () => {
  const route = routeAdaptiveTask(candidates, { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation", affectedFiles: 4, dependencyCount: 1, technicalRisk: "medium", confidence: 0.8 } });
  assert.equal(route.complexity, "MEDIUM");
  assert.equal(route.profile, "BALANCED");
  assert.equal(route.modelId, "gpt-6.1-sol");
});

test("an integration with high risk and low confidence selects ADVANCED", () => {
  const route = routeAdaptiveTask(candidates, { taskType: "integration", capability: "coding", signals: { taskKind: "integration", affectedFiles: 8, dependencyCount: 4, technicalRisk: "high", reasoningNeed: "high", confidence: 0.2 } });
  assert.equal(route.complexity, "HIGH");
  assert.equal(route.profile, "ADVANCED");
  assert.equal(route.modelId, "gpt-6-astra");
});

test("deterministic work bypasses every model and reports no fabricated usage", () => {
  const route = routeAdaptiveTask([], { taskType: "test", capability: "test", signals: { deterministic: true } });
  assert.equal(route.action, "deterministic");
  assert.equal(route.profile, "ECONOMY");
  assert.deepEqual(route.usage, { inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null });
});

test("infrastructure failures never trigger model escalation", () => {
  assert.equal(classifyExecutionFailure("EPERM: operation not permitted opening local socket"), "infrastructure");
  assert.equal(shouldEscalateModel("infrastructure", "BALANCED", 0), false);
  const route = routeAdaptiveTask(candidates, { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation" }, priorFailure: "infrastructure" });
  assert.equal(route.action, "blocked");
  assert.match(route.reason, /do not escalate model/);
});

test("a reasoning failure may escalate once, with the preserved task type", () => {
  assert.equal(classifyExecutionFailure("Reasoning analysis failed to solve the task"), "reasoning");
  assert.equal(shouldEscalateModel("reasoning", "BALANCED", 0), true);
  assert.equal(shouldEscalateModel("reasoning", "BALANCED", 1), false);
  assert.equal(shouldEscalateModel("quality", "ADVANCED", 0), false);
  const escalated = routeAdaptiveTask(candidates, { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation", technicalRisk: "medium" }, priorFailure: "quality", priorModelProfile: "BALANCED", attempts: 0 });
  assert.equal(escalated.modelId, "gpt-6-astra");
  assert.equal(escalated.escalationCount, 1);
  assert.equal(routeAdaptiveTask(candidates, { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation" }, priorFailure: "reasoning", priorModelProfile: "BALANCED", attempts: 1 }).action, "blocked");
});

test("a rate limit falls back only to a different available provider", () => {
  const route = routeAdaptiveTask(candidates, { taskType: "implementation", capability: "coding", signals: { taskKind: "implementation", reasoningNeed: "medium" }, priorFailure: "rate_limit", failedProvider: "codex" });
  assert.equal(route.action, "agent");
  assert.equal(route.provider, "claude-code");
  assert.equal(route.agentId, "claude-sonnet");
  assert.equal(route.modelId, "sonnet");
  assert.equal(route.escalationCount, 1);
});

test("validation prefers Validator and falls back to a compatible active reviewer", () => {
  const reviewers: AdaptiveModelCandidate[] = [
    { ...candidates[1], id: "Analytics", capabilities: ["analysis", "review", "validation"] },
    { ...candidates[1], id: "Validator", capabilities: ["review", "validation"] },
  ];
  assert.equal(routeMaestriStage("VALIDATE", reviewers).agentId, "Validator");
  const fallback = routeMaestriStage("VALIDATE", [reviewers[0]]);
  assert.equal(fallback.agentId, "Analytics");
  assert.match(fallback.reason, /Preferred role Validator is not available/);
});

test("price and token metrics remain unknown unless both are verified", () => {
  const route = routeAdaptiveTask(candidates, { taskType: "review", capability: "review", signals: { taskKind: "test" }, estimatedInputTokens: 1200, reservedOutputTokens: 300 });
  assert.equal(route.estimatedCostUsd, null);
  assert.equal(route.usage.inputTokens, null);
  assert.match(route.reason, /No verified price\/usage estimate/);
});

test("classifier excludes infrastructure history and reports reasoning history", () => {
  const value = classifyTask({ taskKind: "read", affectedFiles: 1, reasoningFailures: 1, infrastructureFailures: 8, technicalRisk: "low" });
  assert.equal(value.complexity, "LOW");
  assert.ok(value.reasons.some(reason => /infrastructure failures were excluded/i.test(reason)));
});

test("Codex discovery retains catalog fields and discards prompt content and prices", () => {
  const configPromise = readModelRouterConfig();
  return configPromise.then(config => {
  const models = parseCodexModelCatalog(JSON.stringify({ models: [
    { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }], model_messages: { persistent_instructions: "MUST NOT ESCAPE" } },
    { slug: "hidden", display_name: "Hidden", visibility: "internal" },
  ] }), config);
  assert.deepEqual(models.map(({ id, profile, supportedEffort, price, usageMetrics }) => ({ id, profile, supportedEffort, price, usageMetrics })), [
    { id: "gpt-6-luna", profile: "ECONOMY", supportedEffort: ["low", "medium"], price: null, usageMetrics: null },
  ]);
  });
});

test("Claude discovery reads only CLI-supported aliases, not account entitlement", async () => {
  const models = parseClaudeModelAliases("--model <model> Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name.", await readModelRouterConfig());
  assert.deepEqual(models.map(model => model.id).sort(), ["fable", "opus", "sonnet"]);
  assert.ok(models.every(model => model.availability === "cli-alias" && model.price === null));
});

test("Maestri session discovery keeps availability unknown even with historical limit text", async () => {
  const config = await readModelRouterConfig();
  const session = parseMaestriSessionMetadata("Analytics", "⚠ less than 5% of your 5h limit\n› Ask Codex to do anything\nGPT-6.1-Sol default · ~/Developer/migration-maestro · task", config);
  assert.equal(session.provider, "codex");
  assert.equal(session.modelId, "gpt-6.1-sol");
  assert.equal(session.profile, "BALANCED");
  assert.equal(session.usagePressure, "near-limit");
  assert.equal(session.availability, "unknown");
  assert.equal(parseMaestriSessionMetadata("Claude", "rate limit exceeded\nClaude Opus 5 · ~/repo · task", config).availability, "unknown");
});

test("Maestri discovery excludes connected portals from agent candidates", () => {
  const names = parseConnectedAgentNames('Connected agents:\n  - name: "Analytics"\nConnected portals (use `maestri portal check`):\n  - name: "Preview"');
  assert.deepEqual(names, ["Analytics"]);
});


test("validation fallback excludes the implementer even when preferred or cheapest", () => {
  const sessions: AdaptiveModelCandidate[] = [
    { ...candidates[2], id: "Hermes", capabilities: ["validation"] },
    { ...candidates[2], id: "Validator", capabilities: ["validation"] },
  ];
  const request = { taskType: "validation", capability: "validation", preferredAgentId: "Hermes",
    excludedAgentIds: ["Hermes"], signals: { technicalRisk: "medium" as const } };
  assert.equal(routeAdaptiveTask(sessions, request).agentId, "Validator");
  assert.equal(routeAdaptiveTask(sessions.slice(0, 1), request).action, "blocked");
  assert.equal(routeMaestriStage("VALIDATE", sessions, { request }).agentId, "Validator");
});

test("critical work requires ADVANCED and additional independent review; hard budgets fail closed", () => {
  const models: AdaptiveModelCandidate[] = [
    { id: "economy", provider: "codex", modelId: "gpt-6-luna", profile: "ECONOMY", capabilities: ["coding"], availability: "available", source: "maestri-session" },
    { id: "advanced", provider: "codex", modelId: "gpt-6-astra", profile: "ADVANCED", capabilities: ["coding"], availability: "available", source: "maestri-session" },
  ];
  const request = { taskType: "critical-fix", capability: "coding", signals: { securityCritical: true } };
  const decision = routeAdaptiveTask(models, request);
  assert.equal(decision.complexity, "CRITICAL"); assert.equal(decision.modelProfile, "ADVANCED"); assert.equal(decision.additionalReviewRequired, true);
  assert.equal(routeAdaptiveTask(models, { ...request, maxEstimatedCostUsd: 1 }).action, "blocked");
  assert.equal(routeAdaptiveTask(models, { ...request, attempts: 2, maxAttempts: 2 }).action, "blocked");
  assert.equal(routeAdaptiveTask(models, { ...request, priorFailure: "authorization" }).action, "blocked");
  const priced = models.map(m => ({ ...m, priceVerified: true, inputPerMillionUsd: 1, outputPerMillionUsd: 2 }));
  assert.equal(routeAdaptiveTask(priced, { ...request, estimatedInputTokens: 1000, reservedOutputTokens: 1000, maxEstimatedCostUsd: 0.004 }).action, "agent");
  assert.equal(routeAdaptiveTask(priced, { ...request, estimatedInputTokens: 1000, reservedOutputTokens: 1000, maxEstimatedCostUsd: 0.001 }).action, "blocked");
});
