import test from "node:test";
import assert from "node:assert/strict";
import { runIntegrationSmoke, smokePrompt } from "../src/maestro-integration-smoke.js";

test("integration smoke prompt contains only diagnostic status, never private source content", () => {
  const prompt = smokePrompt({ status: "completed" }, { status: "failed", reason: "secret" });
  assert.match(prompt, /MAESTRO_INTEGRATION_ACK/);
  assert.doesNotMatch(prompt, /secret/);
});

test("integration smoke rejects invalid queries before invoking any adapters", async () => {
  await assert.rejects(() => runIntegrationSmoke("../unsafe"), /INVALID_SMOKE_QUERY/);
});

test("integration smoke reports missing connectors without claiming readiness", async () => {
  const before = { ...process.env };
  try {
    delete process.env.MAESTRO_ANALYTICS_DIR;
    const result = await runIntegrationSmoke("hero", {
      analytics: async () => { throw Error("unexpected"); },
      config: () => null,
      ue: async () => { throw Error("unexpected"); },
      hermes: async () => ({
        initialized: true, sessionCreated: true, promptSent: true, promptCompleted: true,
        stopReason: "end_turn", responseText: "MAESTRO_INTEGRATION_ACK",
        responseTruncated: false, updatesReceived: 1, serverRequestsDenied: 0,
        toolsEnabled: false, autopilotEnabled: false, reason: "COMPLETED"
      })
    });
    assert.equal(result.analytics.status, "not_configured");
    assert.equal(result.uePattern.status, "not_configured");
    assert.equal(result.hermes.responseMatched, true);
    assert.equal(result.ready, false);
  } finally { process.env.MAESTRO_ANALYTICS_DIR = before.MAESTRO_ANALYTICS_DIR; if (before.MAESTRO_ANALYTICS_DIR === undefined) delete process.env.MAESTRO_ANALYTICS_DIR; }
});
