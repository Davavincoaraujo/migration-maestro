import assert from "node:assert/strict";
import { test } from "node:test";
import { checkHermesAcp } from "../src/adapters/hermes/acp-preflight.js";

test("ACP preflight rejects unsafe executables and timeouts", async () => {
  assert.throws(() => checkHermesAcp("hermes; echo unsafe"), /INVALID_EXECUTABLE/);
  assert.throws(() => checkHermesAcp("hermes", 0), /INVALID_TIMEOUT/);
});

test("ACP preflight fails closed when executable is absent", async () => {
  const result = await checkHermesAcp("missing-hermes-acp-executable-xyz", 1000);
  assert.deepEqual(result, { available: false, reason: "ACP_UNAVAILABLE" });
});
