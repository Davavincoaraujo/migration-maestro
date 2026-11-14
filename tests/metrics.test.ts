import test from "node:test";
import assert from "node:assert/strict";
import { summarizeUsage, withinBudget } from "../src/observability/metrics.js";
test("aggregates synthetic usage and estimates BRL cost", () => {
  const metrics = summarizeUsage([
    { jobId: "job_1", stage: "discover", durationMs: 120, inputTokens: 1000, outputTokens: 500, calls: 1, errors: 0, reusedEvidence: 0 },
    { jobId: "job_1", stage: "validate", durationMs: 80, inputTokens: 500, outputTokens: 0, calls: 1, errors: 0, reusedEvidence: 1 },
  ], { inputPerMillionBRL: 10, outputPerMillionBRL: 20 });
  assert.equal(metrics[0].durationMs, 200);
  assert.equal(metrics[0].estimatedCostBRL, 0.025);
  assert.equal(withinBudget(metrics[0], { maxCostBRL: 0.03, maxTokens: 2000, maxCalls: 2 }), true);
  assert.equal(withinBudget(metrics[0], { maxCostBRL: 0.01, maxTokens: 2000, maxCalls: 2 }), false);
});
test("rejects negative usage", () => {
  assert.throws(() => summarizeUsage([{ jobId: "job", stage: "discover", durationMs: -1, inputTokens: 0, outputTokens: 0, calls: 0, errors: 0, reusedEvidence: 0 }], { inputPerMillionBRL: 1, outputPerMillionBRL: 1 }), /Invalid usage/);
});
