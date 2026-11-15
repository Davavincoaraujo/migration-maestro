import assert from "node:assert/strict";
import { test } from "node:test";
import { probeAcpHandshake } from "../src/adapters/hermes/acp-handshake.js";

test("ACP handshake rejects unsafe configuration", () => {
  assert.throws(() => probeAcpHandshake({ executable: "hermes; rm" }), /INVALID_ACP_CONFIG/);
  assert.throws(() => probeAcpHandshake({ timeoutMs: 0 }), /INVALID_ACP_CONFIG/);
  assert.throws(() => probeAcpHandshake({ args: ["--yolo"] }), /INVALID_ACP_CONFIG/);
});

test("ACP handshake fails closed when process is absent", async () => {
  const result = await probeAcpHandshake({ executable: "missing-acp-executable-xyz", timeoutMs: 1000 });
  assert.deepEqual(result, { connected: false, reason: "PROCESS_UNAVAILABLE" });
});
