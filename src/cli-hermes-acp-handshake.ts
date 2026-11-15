import { probeAcpHandshake } from "./adapters/hermes/acp-handshake.js";

try {
  const result = await probeAcpHandshake();
  console.log(JSON.stringify({
    ...result,
    sessionCreated: false,
    toolsEnabled: false,
    note: "Initialize handshake only; no agent session or prompt"
  }, null, 2));
  if (!result.connected) process.exitCode = 1;
} catch {
  console.error("ACP_HANDSHAKE_INVALID_CONFIG");
  process.exitCode = 1;
}
