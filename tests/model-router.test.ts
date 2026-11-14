import test from "node:test";
import assert from "node:assert/strict";
import { routeModel } from "../src/ai/model-router.js";
const models = [
  { id: "expensive", capabilities: ["vision"], maxInputTokens: 10000, inputPerMillionBRL: 10, outputPerMillionBRL: 20 },
  { id: "economy", capabilities: ["vision"], maxInputTokens: 10000, inputPerMillionBRL: 2, outputPerMillionBRL: 4 },
];
test("chooses cheapest compatible model within budget", () => {
  const result = routeModel(models, { requiredCapabilities: ["vision"], estimatedInputTokens: 1000, reservedOutputTokens: 1000, maxEstimatedCostBRL: 0.01 });
  assert.equal(result?.modelId, "economy");
  assert.equal(result?.requiresApproval, true);
});
test("returns null when no model fits", () => {
  const result = routeModel(models, { requiredCapabilities: ["audio"], estimatedInputTokens: 1000, reservedOutputTokens: 100, maxEstimatedCostBRL: 1 });
  assert.equal(result, null);
});
