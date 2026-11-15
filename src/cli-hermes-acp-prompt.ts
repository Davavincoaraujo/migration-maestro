import { executeHermesPrompt } from "./adapters/hermes/acp-executor.js";

try {
  const timeoutMs = process.env.MAESTRO_ACP_PROMPT_TIMEOUT_MS === undefined
    ? 120000 : Number(process.env.MAESTRO_ACP_PROMPT_TIMEOUT_MS);
  const result = await executeHermesPrompt(undefined, "hermes", timeoutMs);
  console.log(JSON.stringify(result, null, 2));
  if (!result.promptCompleted) process.exitCode = 1;
} catch {
  console.error("ACP_PROMPT_EXECUTION_FAILED");
  process.exitCode = 1;
}
