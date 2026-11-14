export interface UsageEvent {
  jobId: string;
  stage: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  errors: number;
  reusedEvidence: number;
}
export interface RateCard {
  inputPerMillionBRL: number;
  outputPerMillionBRL: number;
}
export interface JobMetrics {
  jobId: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  errors: number;
  reusedEvidence: number;
  estimatedCostBRL: number;
}
export function summarizeUsage(events: readonly UsageEvent[], rates: RateCard): JobMetrics[] {
  if (!events.length) return [];
  if (![rates.inputPerMillionBRL, rates.outputPerMillionBRL].every(n => Number.isFinite(n) && n >= 0)) throw new Error("Invalid rate card");
  const totals = new Map<string, JobMetrics>();
  for (const e of events) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(e.jobId) || !/^[a-z][a-z0-9-]{0,63}$/.test(e.stage) ||
        ![e.durationMs, e.inputTokens, e.outputTokens, e.calls, e.errors, e.reusedEvidence]
          .every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid usage event");
    const row = totals.get(e.jobId) ?? { jobId: e.jobId, durationMs: 0, inputTokens: 0, outputTokens: 0, calls: 0, errors: 0, reusedEvidence: 0, estimatedCostBRL: 0 };
    row.durationMs += e.durationMs;
    row.inputTokens += e.inputTokens;
    row.outputTokens += e.outputTokens;
    row.calls += e.calls;
    row.errors += e.errors;
    row.reusedEvidence += e.reusedEvidence;
    row.estimatedCostBRL = Math.round((row.inputTokens * rates.inputPerMillionBRL + row.outputTokens * rates.outputPerMillionBRL) / 1_000_000 * 10000) / 10000;
    totals.set(e.jobId, row);
  }
  return [...totals.values()].sort((a, b) => a.jobId.localeCompare(b.jobId));
}
export function withinBudget(row: JobMetrics, limits: { maxCostBRL: number; maxTokens: number; maxCalls: number }): boolean {
  if (![limits.maxCostBRL, limits.maxTokens, limits.maxCalls].every(n => Number.isFinite(n) && n >= 0)) throw new Error("Invalid budget");
  return row.estimatedCostBRL <= limits.maxCostBRL &&
    row.inputTokens + row.outputTokens <= limits.maxTokens && row.calls <= limits.maxCalls;
}
