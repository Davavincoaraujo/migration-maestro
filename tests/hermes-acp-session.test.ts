import assert from "node:assert/strict";
import { test } from "node:test";
import { probeHermesSession } from "../src/adapters/hermes/acp-session.js";

test("session probe validates executable and timeout", async () => {
  await assert.rejects(probeHermesSession("hermes; echo unsafe"), /INVALID_SESSION_CONFIG/);
  assert.rejects(probeHermesSession("hermes", 0), /INVALID_SESSION_CONFIG/);
});

test("session probe fails closed without executable", async () => {
  const result = await probeHermesSession("missing-hermes-session-executable-xyz", 1000);
  assert.deepEqual(result, { initialized: false, sessionCreated: false, stage: "waiting_initialize", serverRequestsDenied: 0, notificationsReceived: 0, reason: "PROCESS_UNAVAILABLE" });
});
