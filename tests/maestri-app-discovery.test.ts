import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverMaestriAgents } from "../src/adapters/maestri/discovery.js";

test("Maestri discovery rejects invalid timeouts", async () => {
  await assert.rejects(discoverMaestriAgents(0), /INVALID_TIMEOUT/);
  await assert.rejects(discoverMaestriAgents(30001), /INVALID_TIMEOUT/);
});

test("Maestri app detection never claims agents are connected", async () => {
  const result = await discoverMaestriAgents();
  assert.equal(result.available, false);
  assert.equal(result.agentsAvailable, false);
  assert.equal(result.command, "none");
  assert.ok(["APP_NOT_FOUND", "INTEGRATION_NOT_CONFIGURED", "UNSUPPORTED_PLATFORM"].includes(result.reason ?? ""));
  if (result.appInstalled) {
    assert.equal(result.reason, "INTEGRATION_NOT_CONFIGURED");
    assert.ok(result.appPath?.endsWith("/Maestri.app"));
  }
});
