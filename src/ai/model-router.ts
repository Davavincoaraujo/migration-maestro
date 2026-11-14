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
