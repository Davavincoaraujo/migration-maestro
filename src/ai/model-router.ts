export interface ModelProfile {
  id: string;
  capabilities: readonly string[];
  maxInputTokens: number;
  inputPerMillionBRL: number;
  outputPerMillionBRL: number;
}
export interface RoutingRequest {
  requiredCapabilities: readonly string[];
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  maxEstimatedCostBRL: number;
}
export interface RoutingDecision {
  modelId: string;
  estimatedCostBRL: number;
  requiresApproval: true;
}

export type TaskComplexity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdaptiveProfile = "ECONOMY" | "BALANCED" | "ADVANCED";
export type FailureKind = "infrastructure" | "rate_limit" | "reasoning" | "quality" | "authorization" | "unknown";
export type Provider = "codex" | "claude-code" | "unknown";

/** Inputs are measured by deterministic inspection, not an extra model call. */
export interface TaskSignals {
  deterministic?: boolean;
  securityCritical?: boolean;
  businessCritical?: boolean;
  taskKind?: "read" | "transform" | "test" | "implementation" | "integration" | "architecture" | "investigation";
  affectedFiles?: number;
  dependencyCount?: number;
  technicalRisk?: "low" | "medium" | "high";
  reasoningNeed?: "low" | "medium" | "high";
  confidence?: number;
  reasoningFailures?: number;
  infrastructureFailures?: number;
}

export interface ComplexityAssessment {
  complexity: TaskComplexity;
  profile: AdaptiveProfile;
  score: number;
  deterministic: boolean;
  reasons: string[];
}

export interface AdaptiveModelCandidate {
  id: string;
  provider: Provider;
  modelId: string;
  profile: AdaptiveProfile | "UNKNOWN";
  capabilities: readonly string[];
  availability: "available" | "unavailable" | "unknown";
  source: "maestri-session" | "verified-runtime" | "codex-cli-catalog" | "claude-code-help";
  /** Only set from a verifiable provider price table for the actual billing mode. */
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  priceVerified?: boolean;
  latencyMs?: number;
  successRateByTask?: Readonly<Record<string, number>>;
}

export interface AdaptiveRouteRequest {
  taskType: string;
  capability: string;
  preferredAgentId?: string;
  excludedAgentIds?: readonly string[];
  signals: TaskSignals;
  estimatedInputTokens?: number;
  reservedOutputTokens?: number;
  priorFailure?: FailureKind;
  failedProvider?: Provider;
  priorModelProfile?: AdaptiveProfile;
  attempts?: number;
  maxAttempts?: number;
  maxEstimatedCostUsd?: number;
}

export interface AdaptiveRouteDecision {
  additionalReviewRequired?: boolean;
  alternatives?: { agentId: string; modelId: string; estimatedCostUsd: number | null }[];
  action: "deterministic" | "agent" | "blocked";
  profile: AdaptiveProfile;
  complexity: TaskComplexity;
  agentId?: string;
  provider?: Provider;
  modelId?: string;
  modelProfile?: AdaptiveProfile;
  estimatedCostUsd: number | null;
  reason: string;
  attempts: number;
  escalationCount: number;
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null; latencyMs: number | null };
}

const profileRank: Record<AdaptiveProfile, number> = { ECONOMY: 0, BALANCED: 1, ADVANCED: 2 };
const boundedCount = (value: number | undefined): number => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : 0;

/** Small, auditable rules. Infrastructure failures never increase complexity. */
export function classifyTask(signals: TaskSignals): ComplexityAssessment {
  if (signals.deterministic) return {
    complexity: "LOW", profile: "ECONOMY", score: 0, deterministic: true,
    reasons: ["Deterministic operation; use the local script/tool path without an AI call."],
  };
  let score = 0;
  const reasons: string[] = [];
  const files = boundedCount(signals.affectedFiles);
  const dependencies = boundedCount(signals.dependencyCount);
  if (files >= 8) { score += 3; reasons.push("Many files in scope (8+)."); }
  else if (files >= 4) { score += 2; reasons.push("Several files in scope (4–7)."); }
  else if (files >= 2) { score += 1; reasons.push("Multiple files in scope (2–3)."); }
  if (dependencies >= 4) { score += 2; reasons.push("Several dependency boundaries (4+)."); }
  else if (dependencies >= 2) { score += 1; reasons.push("Multiple dependency boundaries (2–3)."); }
  if (signals.technicalRisk === "high") { score += 3; reasons.push("High technical risk."); }
  else if (signals.technicalRisk === "medium") { score += 1; reasons.push("Medium technical risk."); }
  if (signals.reasoningNeed === "high") { score += 3; reasons.push("High reasoning requirement."); }
  else if (signals.reasoningNeed === "medium") { score += 1; reasons.push("Moderate reasoning requirement."); }
  if (["integration", "architecture", "investigation"].includes(signals.taskKind ?? "")) { score += 2; reasons.push(`Task type ${signals.taskKind} needs broader reasoning.`); }
  if (Number.isFinite(signals.confidence) && (signals.confidence as number) < 0.35) { score += 2; reasons.push("Low confidence in the proposed solution."); }
  else if (Number.isFinite(signals.confidence) && (signals.confidence as number) < 0.65) { score += 1; reasons.push("Solution confidence is below 0.65."); }
  if (boundedCount(signals.reasoningFailures) >= 2) { score += 2; reasons.push("Repeated reasoning failures in task history."); }
  else if (boundedCount(signals.reasoningFailures) === 1) { score += 1; reasons.push("A reasoning failure is present in task history."); }
  if (boundedCount(signals.infrastructureFailures)) reasons.push("Infrastructure failures were excluded from the complexity score.");
  const critical = signals.securityCritical === true || signals.businessCritical === true;
  if (critical) reasons.push("Critical security or business impact requires independent additional review.");
  const complexity: TaskComplexity = critical ? "CRITICAL" : score >= 5 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
  const profile: AdaptiveProfile = (complexity === "HIGH" || complexity === "CRITICAL") ? "ADVANCED" : complexity === "MEDIUM" ? "BALANCED" : "ECONOMY";
  if (!reasons.length) reasons.push("Few files, dependencies, risk, and reasoning requirements.");
  return { complexity, profile, score, deterministic: false, reasons };
}

function validPrice(model: AdaptiveModelCandidate): boolean {
  return model.priceVerified === true && Number.isFinite(model.inputPerMillionUsd) && Number.isFinite(model.outputPerMillionUsd) &&
    (model.inputPerMillionUsd as number) >= 0 && (model.outputPerMillionUsd as number) >= 0;
}

/** Chooses only an already configured, available session; it never switches a live session's model. */
export function routeAdaptiveTask(models: readonly AdaptiveModelCandidate[], request: AdaptiveRouteRequest): AdaptiveRouteDecision {
  const assessment = classifyTask(request.signals);
  const attempts = Number.isSafeInteger(request.attempts) && (request.attempts as number) >= 0 ? request.attempts as number : 0;
  const usage = { inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null };
  if (assessment.deterministic) return {
    action: "deterministic", profile: "ECONOMY", complexity: "LOW", estimatedCostUsd: null,
    reason: assessment.reasons[0], attempts, escalationCount: 0, usage,
  };
  if ((request.maxAttempts !== undefined && (!Number.isSafeInteger(request.maxAttempts) || request.maxAttempts < 1 || request.maxAttempts > 30)) ||
      (request.maxEstimatedCostUsd !== undefined && (!Number.isFinite(request.maxEstimatedCostUsd) || request.maxEstimatedCostUsd < 0))) throw Error("INVALID_ROUTING_BUDGET");
  if (request.maxAttempts !== undefined && attempts >= request.maxAttempts) return {
    action: "blocked", profile: assessment.profile, complexity: assessment.complexity, estimatedCostUsd: null,
    reason: "Task attempt budget exhausted; circuit remains open until operator review.", attempts, escalationCount: 0, usage,
  };
  if (request.priorFailure === "infrastructure" || request.priorFailure === "authorization") return {
    action: "blocked", profile: assessment.profile, complexity: assessment.complexity, estimatedCostUsd: null,
    reason: "Infrastructure or authorization failure: diagnose access/transport; do not escalate model.", attempts, escalationCount: 0, usage,
  };
  const escalating = request.priorFailure === "reasoning" || request.priorFailure === "quality";
  if (escalating && !shouldEscalateModel(request.priorFailure!, request.priorModelProfile ?? assessment.profile, attempts)) return {
    action: "blocked", profile: assessment.profile, complexity: assessment.complexity, estimatedCostUsd: null,
    reason: "Model escalation is not allowed for this failure or the one-escalation budget is exhausted.", attempts, escalationCount: 0, usage,
  };
  const requiredRank = escalating ? Math.max(profileRank[assessment.profile], profileRank[request.priorModelProfile ?? assessment.profile] + 1) : profileRank[assessment.profile];
  const matching = models.filter(model => !request.excludedAgentIds?.includes(model.id) && (model.source === "maestri-session" || model.source === "verified-runtime") && model.availability === "available" && model.profile !== "UNKNOWN" &&
    profileRank[model.profile] >= requiredRank && model.capabilities.includes(request.capability) &&
    !(request.priorFailure === "rate_limit" && model.provider === request.failedProvider));
  const withCosts = request.estimatedInputTokens !== undefined && request.reservedOutputTokens !== undefined &&
    [request.estimatedInputTokens, request.reservedOutputTokens].every(n => Number.isSafeInteger(n) && n >= 0);
  const estimate = (candidate: AdaptiveModelCandidate): number | null => withCosts && validPrice(candidate)
    ? (request.estimatedInputTokens! * candidate.inputPerMillionUsd! + request.reservedOutputTokens! * candidate.outputPerMillionUsd!) / 1_000_000 : null;
  // A hard monetary budget cannot be enforced using unknown subscription prices.
  const affordable = matching.filter(candidate => request.maxEstimatedCostUsd === undefined || (estimate(candidate) !== null && estimate(candidate)! <= request.maxEstimatedCostUsd));
  const sorted = [...affordable].sort((a, b) => {
    if (withCosts && validPrice(a) && validPrice(b)) {
      const ac = ((request.estimatedInputTokens as number) * (a.inputPerMillionUsd as number) + (request.reservedOutputTokens as number) * (a.outputPerMillionUsd as number)) / 1_000_000;
      const bc = ((request.estimatedInputTokens as number) * (b.inputPerMillionUsd as number) + (request.reservedOutputTokens as number) * (b.outputPerMillionUsd as number)) / 1_000_000;
      if (ac !== bc) return ac - bc;
    }
    const preferred = Number(b.id === request.preferredAgentId) - Number(a.id === request.preferredAgentId);
    if (preferred) return preferred;
    const taskSuccessA = a.successRateByTask?.[request.taskType];
    const taskSuccessB = b.successRateByTask?.[request.taskType];
    return profileRank[a.profile as AdaptiveProfile] - profileRank[b.profile as AdaptiveProfile] ||
      (taskSuccessB ?? -1) - (taskSuccessA ?? -1) ||
      (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER);
  });
  const chosen = sorted[0];
  if (!chosen) return { action: "blocked", profile: assessment.profile, complexity: assessment.complexity, estimatedCostUsd: null,
    reason: matching.length && !affordable.length ? "No eligible session has a verified estimate within the task budget; unknown costs are not zero." : request.priorFailure === "rate_limit" ? "Provider usage limit: no different available authorized provider satisfies this task." :
      `No available configured session satisfies ${assessment.profile} and capability ${request.capability}.`,
    attempts, escalationCount: 0, usage };
  const estimatedCostUsd = withCosts && validPrice(chosen)
    ? ((request.estimatedInputTokens as number) * (chosen.inputPerMillionUsd as number) + (request.reservedOutputTokens as number) * (chosen.outputPerMillionUsd as number)) / 1_000_000
    : null;
  const learned = chosen.successRateByTask?.[request.taskType];
  const preferredFallback = request.preferredAgentId && chosen.id !== request.preferredAgentId
    ? ` Preferred role ${request.preferredAgentId} is not available with this capability/profile; routed to the lowest-profile compatible active session.` : "";
  return { additionalReviewRequired: assessment.complexity === "CRITICAL", alternatives: sorted.map(candidate => ({ agentId: candidate.id, modelId: candidate.modelId, estimatedCostUsd: estimate(candidate) })), action: "agent", profile: assessment.profile, complexity: assessment.complexity, agentId: chosen.id,
    provider: chosen.provider, modelId: chosen.modelId, modelProfile: chosen.profile as AdaptiveProfile, estimatedCostUsd,
    reason: `${assessment.reasons.join(" ")} ${estimatedCostUsd === null ? "No verified price/usage estimate; selecting the lowest available configured profile that meets the task requirement." : "Selected the lowest verified estimated cost among compatible sessions."}${preferredFallback}${learned === undefined ? " No task-specific success history is available." : ` Historical success for this task: ${Math.round(learned * 100)}%.`}`,
    attempts, escalationCount: escalating || request.priorFailure === "rate_limit" ? 1 : 0,
    usage: { ...usage, latencyMs: chosen.latencyMs ?? null },
  };
}

/** Infrastructure errors are retryable without changing providers/models. */
export function classifyExecutionFailure(message: string): FailureKind {
  if (/authentication|unauthorized|forbidden|permission denied|authorization.required|credentials|auth.*required/i.test(message)) return "authorization";
  if (/operation not permitted|eperm|socket|ipc|timed? ?out|timeout|econnrefused|enoent|command not found|missing script|cannot find module|network|transport|maestri_unavailable/i.test(message)) return "infrastructure";
  if (/rate.?limit|usage.?limit|quota.?exceeded|resource.?exhausted|out of.*credits/i.test(message)) return "rate_limit";
  if (/invalid.*reason|reasoning|analysis.*failed|could not solve/i.test(message)) return "reasoning";
  if (/contract|quality|validation|incomplete|incorrect/i.test(message)) return "quality";
  return "unknown";
}

export function shouldEscalateModel(failure: FailureKind, current: AdaptiveProfile, attempts: number): boolean {
  return (failure === "reasoning" || failure === "quality") && attempts < 1 && current !== "ADVANCED";
}

export function routeModel(models: readonly ModelProfile[], request: RoutingRequest): RoutingDecision | null {
  if (!models.length || models.length > 100 ||
      !Number.isSafeInteger(request.estimatedInputTokens) || request.estimatedInputTokens < 0 ||
      !Number.isSafeInteger(request.reservedOutputTokens) || request.reservedOutputTokens < 0 ||
      !Number.isFinite(request.maxEstimatedCostBRL) || request.maxEstimatedCostBRL < 0 ||
      !Array.isArray(request.requiredCapabilities) ||
      request.requiredCapabilities.some(c => typeof c !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(c))) throw new Error("Invalid routing request");
  const decisions = models.map(model => {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model.id) ||
        !Number.isSafeInteger(model.maxInputTokens) || model.maxInputTokens < 1 ||
        ![model.inputPerMillionBRL, model.outputPerMillionBRL].every(n => Number.isFinite(n) && n >= 0) ||
        !Array.isArray(model.capabilities)) throw new Error("Invalid model profile");
    const cost = (request.estimatedInputTokens * model.inputPerMillionBRL +
      request.reservedOutputTokens * model.outputPerMillionBRL) / 1_000_000;
    return { model, cost };
  }).filter(({ model, cost }) =>
    model.maxInputTokens >= request.estimatedInputTokens &&
    request.requiredCapabilities.every(c => model.capabilities.includes(c)) &&
    cost <= request.maxEstimatedCostBRL
  ).sort((a, b) => a.cost - b.cost || a.model.id.localeCompare(b.model.id));
  const chosen = decisions[0];
  return chosen ? { modelId: chosen.model.id, estimatedCostBRL: chosen.cost, requiresApproval: true } : null;
}
