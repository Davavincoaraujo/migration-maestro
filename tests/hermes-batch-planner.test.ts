import { test } from "node:test";
import { strict as assert } from "node:assert";
import { planHermesBatch, validatePageInputs } from "../src/integrations/hermes-batch-planner.js";
import type { executeHermesPrompt } from "../src/adapters/hermes/acp-executor.js";

const pages = [{ id: "demo", route: "/demo", components: ["hero"] }];
test("rejects unsafe routes and duplicate ids", () => {
  assert.throws(() => validatePageInputs([{ id: "x", route: "/../bad", components: [] }]));
  assert.throws(() => validatePageInputs([pages[0], pages[0]]));
});
test("accepts validated analysis without authorizing execution", async () => {
  const fake = (async () => ({
    initialized: true, sessionCreated: true, promptSent: true, promptCompleted: true,
    stopReason: "end_turn", updatesReceived: 1, serverRequestsDenied: 0,
    responseTruncated: false, toolsEnabled: false as const, autopilotEnabled: false as const,
    reason: "COMPLETED" as const,
    responseText: JSON.stringify({ kind: "migration-analysis", version: 1,
      summary: "Teste", components: ["hero"], risks: [], nextSteps: [] })
  })) as typeof executeHermesPrompt;
  const result = await planHermesBatch(pages, fake);
  assert.equal(result.planned, 1);
  assert.equal(result.codeExecutionAuthorized, false);
  assert.equal(result.humanApprovalRequired, true);
});
test("marks invalid agent response for review", async () => {
  const fake = (async () => ({
    initialized: true, sessionCreated: true, promptSent: true, promptCompleted: true,
    stopReason: "end_turn", updatesReceived: 1, serverRequestsDenied: 0,
    responseTruncated: false, toolsEnabled: false as const, autopilotEnabled: false as const,
    reason: "COMPLETED" as const, responseText: "not-json"
  })) as typeof executeHermesPrompt;
  const result = await planHermesBatch(pages, fake);
  assert.equal(result.reviewRequired, 1);
  assert.equal(result.results[0].reason, "INVALID_JSON");
});
