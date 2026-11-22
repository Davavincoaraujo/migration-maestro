import test from "node:test";
import assert from "node:assert/strict";
import { runIntegrationSmoke, smokePrompt } from "../src/maestro-integration-smoke.js";

test("integration smoke prompt contains only diagnostic status, never private source content", () => {
  const prompt = smokePrompt({ status: "completed" }, { status: "failed", reason: "secret" });
  assert.match(prompt, /MAESTRO_INTEGRATION_ACK/);
  assert.doesNotMatch(prompt, /secret/);
  assert.doesNotMatch(prompt, /Status MCP|Status UE-Pattern|completed|failed/);
  assert.equal(prompt, smokePrompt({ status: "failed" }, { status: "not_configured" }));
});

test("ACK validation rejects explanatory suffixes, truncation, refusals and permission requests", async () => {
  const original = process.env.MAESTRO_ANALYTICS_DIR;
  delete process.env.MAESTRO_ANALYTICS_DIR;
  try {
    for (const variant of [
      { responseText: "MAESTRO_INTEGRATION_ACK", expected: true },
      { responseText: "MAESTRO_INTEGRATION_ACK\nStatus MCP: completed", expected: false },
      { responseText: "**MAESTRO_INTEGRATION_ACK**", expected: false },
      { responseText: "MAESTRO_INTEGRATION_ACK", responseTruncated: true, expected: false },
      { responseText: "MAESTRO_INTEGRATION_ACK", stopReason: "refusal", expected: false },
      { responseText: "MAESTRO_INTEGRATION_ACK", serverRequestsDenied: 1, expected: false }
    ]) {
      const { expected, ...response } = variant;
      const result = await runIntegrationSmoke("hero", {
        analytics: async () => { throw Error("not configured"); }, config: () => null,
        ue: async () => { throw Error("not configured"); },
        hermes: async () => ({ initialized: true, sessionCreated: true, promptSent: true, promptCompleted: true,
          stopReason: "end_turn", responseTruncated: false, updatesReceived: 1, serverRequestsDenied: 0,
          toolsEnabled: false, autopilotEnabled: false, reason: "COMPLETED", ...response })
      });
      assert.equal(result.hermes.responseMatched, expected);
    }
  } finally { if (original === undefined) delete process.env.MAESTRO_ANALYTICS_DIR; else process.env.MAESTRO_ANALYTICS_DIR = original; }
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
