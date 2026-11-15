import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectLocalIntegrations } from "../src/core/integration/doctor.js";

test("integration doctor never claims an unconfigured agent can execute", async () => {
  const report = await inspectLocalIntegrations();
  assert.equal(report.maestri.agentsConnected, false);
  assert.equal(report.hermes.executionConfigured, false);
  assert.equal(report.readyForAutonomousExecution, false);
  assert.ok(typeof report.maestri.installed === "boolean");
  assert.ok(typeof report.hermes.cliAvailable === "boolean");
  assert.ok(!JSON.stringify(report).includes("token"));
});
