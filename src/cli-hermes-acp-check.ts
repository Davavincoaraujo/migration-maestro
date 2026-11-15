import { checkHermesAcp } from "./adapters/hermes/acp-preflight.js";

try {
  const result = await checkHermesAcp();
  console.log(JSON.stringify({
    ...result,
    protocolSessionConfigured: false,
    agentExecutionEnabled: false,
    note: "ACP dependency check only; no agent session or tool execution"
  }, null, 2));
  if (!result.available) process.exitCode = 1;
} catch {
  console.error("ACP_PREFLIGHT_INVALID_CONFIGURATION");
  process.exitCode = 1;
}
