import assert from "node:assert/strict";
import { test } from "node:test";
import { requireMaestriSocket, askMaestri } from "../src/maestro-maestri-bridge.js";

test("Maestri bridge requires an explicit Maestri terminal socket", async () => {
  assert.throws(() => requireMaestriSocket(undefined), /MAESTRI_SOCKET_REQUIRED/);
  assert.throws(() => requireMaestriSocket(""), /MAESTRI_SOCKET_REQUIRED/);
  assert.equal(requireMaestriSocket("/tmp/maestri.sock"), "/tmp/maestri.sock");
  const previous = process.env.MAESTRI_SOCKET;
  delete process.env.MAESTRI_SOCKET;
  try {
    await assert.rejects(askMaestri("Hermes", "hello"), /MAESTRI_SOCKET_REQUIRED/);
  } finally {
    if (previous !== undefined) process.env.MAESTRI_SOCKET = previous;
  }
});
