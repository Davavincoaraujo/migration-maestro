import { executeHermesPrompt } from "./adapters/hermes/acp-executor.js";
import { validateAgentArtifact } from "./adapters/hermes/artifact-validator.js";

const prompt = [
  "Analise apenas estes dados fictícios de uma página AEM:",
  "pageTitle: Exemplo; componentes: hero, faq; rota: /exemplo.",
  "Não use ferramentas, arquivos, rede nem dados externos.",
  "Responda SOMENTE com um objeto JSON válido, sem Markdown, com estas propriedades exatas:",
  '{"kind":"migration-analysis","version":1,"summary":"...","components":["..."],"risks":["..."],"nextSteps":["..."]}',
  "Não inclua informações sensíveis. Escreva em português."
].join("\n");

try {
  const timeoutMs = process.env.MAESTRO_ACP_PROMPT_TIMEOUT_MS === undefined
    ? 120000 : Number(process.env.MAESTRO_ACP_PROMPT_TIMEOUT_MS);
  const execution = await executeHermesPrompt(prompt, "hermes", timeoutMs);
  const validation = validateAgentArtifact(execution.responseText, execution.responseTruncated);
  const { responseText: _discard, ...safeExecution } = execution;
  console.log(JSON.stringify({ ...safeExecution, artifactValid: validation.valid,
    validationReason: validation.reason,
    ...(validation.valid ? { artifact: validation.artifact } : {})
  }, null, 2));
  if (!execution.promptCompleted || execution.stopReason !== "end_turn" || !validation.valid) process.exitCode = 1;
} catch {
  console.error("ACP_ARTIFACT_EXECUTION_FAILED");
  process.exitCode = 1;
}
