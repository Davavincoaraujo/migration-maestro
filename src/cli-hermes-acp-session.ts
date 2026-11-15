import { probeHermesSession } from "./adapters/hermes/acp-session.js";

try {
  const rawTimeout = process.env.MAESTRO_ACP_TIMEOUT_MS;
  const timeoutMs = rawTimeout === undefined ? 30000 : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw new Error("INVALID_ACP_TIMEOUT");
  }
  const result = await probeHermesSession("hermes", timeoutMs);
  console.log(JSON.stringify({ ...result, promptSent: false, toolsEnabled: false, autopilotEnabled: false }, null, 2));
  if (!result.sessionCreated) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && error.message === "INVALID_ACP_TIMEOUT" ? "INVALID_ACP_TIMEOUT" : "ACP_SESSION_PROBE_FAILED");
  process.exitCode = 1;
}
