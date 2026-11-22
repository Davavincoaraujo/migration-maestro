export interface ExecutionBudget { maxDispatches: number; maxJobCostUsd?: number; maxStageCostUsd?: number; }
/** Reservations include prepared and ambiguous tasks; unknown cost can never spend a hard USD budget. */
export function stageBudget(policy: ExecutionBudget, reservations: readonly (number | null)[]): number | undefined {
  if (!Number.isInteger(policy.maxDispatches) || policy.maxDispatches < 1 || policy.maxDispatches > 30 ||
      [policy.maxJobCostUsd, policy.maxStageCostUsd].some(n => n !== undefined && (!Number.isFinite(n) || n < 0)) ||
      reservations.some(n => n !== null && (!Number.isFinite(n) || n < 0))) throw Error("INVALID_EXECUTION_BUDGET");
  if (reservations.length >= policy.maxDispatches) throw Error("JOB_DISPATCH_BUDGET_EXHAUSTED");
  if (policy.maxJobCostUsd !== undefined && reservations.some(n => n === null)) throw Error("JOB_COST_UNKNOWN_CANNOT_ENFORCE_BUDGET");
  const remaining = policy.maxJobCostUsd === undefined ? undefined : policy.maxJobCostUsd - reservations.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (remaining !== undefined && remaining < 0) throw Error("JOB_COST_BUDGET_EXHAUSTED");
  return remaining === undefined ? policy.maxStageCostUsd : policy.maxStageCostUsd === undefined ? remaining : Math.min(remaining, policy.maxStageCostUsd);
}
