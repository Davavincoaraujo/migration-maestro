import { probeHermesSession } from "./adapters/hermes/acp-session.js";

try {
  const result = await probeHermesSession();
  console.log(JSON.stringify({ ...result, promptSent: false, toolsEnabled: false, autopilotEnabled: false }, null, 2));
  if (!result.sessionCreated) process.exitCode = 1;
} catch {
  console.error("ACP_SESSION_PROBE_FAILED");
  process.exitCode = 1;
}
