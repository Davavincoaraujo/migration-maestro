import { executeHermesPrompt } from "../adapters/hermes/acp-executor.js";
import { validateAgentArtifact, type AgentArtifact } from "../adapters/hermes/artifact-validator.js";

export type PageInput = { id: string; route: string; components: string[] };
export type PageOutcome = {
  id: string;
  status: "planned" | "review_required";
  reason: string;
  artifact?: AgentArtifact;
};
export type BatchPlan = {
  mode: "plan-only";
  humanApprovalRequired: true;
  codeExecutionAuthorized: false;
  total: number;
  planned: number;
  reviewRequired: number;
  results: PageOutcome[];
};

export function validatePageInputs(value: unknown): PageInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw Error("INVALID_BATCH");
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("INVALID_PAGE");
    const p = item as Record<string, unknown>;
    if (Object.keys(p).some(k => !["id", "route", "components"].includes(k)) ||
      typeof p.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || seen.has(p.id) ||
      typeof p.route !== "string" || !/^\/[a-zA-Z0-9/_-]{1,180}$/.test(p.route) ||
      !Array.isArray(p.components) || p.components.length > 20 ||
      !p.components.every((v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v))) {
      throw Error("INVALID_PAGE");
    }
    seen.add(p.id);
    return { id: p.id, route: p.route, components: p.components as string[] };
  });
}

export async function planHermesBatch(
  pages: PageInput[],
  execute: typeof executeHermesPrompt = executeHermesPrompt
): Promise<BatchPlan> {
  const checked = validatePageInputs(pages);
  const results: PageOutcome[] = [];
  for (const page of checked) {
    const prompt = [
      "Analise somente estes metadados fictícios; não use ferramentas nem fontes externas.",
      JSON.stringify(page),
      "Responda APENAS JSON sem Markdown com exatamente estas chaves:",
      '{"kind":"migration-analysis","version":1,"summary":"...","components":["..."],"risks":["..."],"nextSteps":["..."]}',
      "Não presuma que integrações, APIs ou componentes existem além dos metadados fornecidos.",
      "Escreva em português."
    ].join("\n");
    try {
      const run = await execute(prompt);
      const validated = validateAgentArtifact(run.responseText, run.responseTruncated);
      const accepted = run.promptCompleted && run.stopReason === "end_turn" &&
        run.serverRequestsDenied === 0 && validated.valid;
      results.push({
        id: page.id,
        status: accepted ? "planned" : "review_required",
        reason: accepted ? "VALID" : !run.promptCompleted ? run.reason :
          run.serverRequestsDenied ? "PERMISSION_REQUESTED" :
          run.stopReason !== "end_turn" ? "INCOMPLETE_TURN" : validated.reason,
        ...(accepted ? { artifact: validated.artifact } : {})
      });
    } catch {
      results.push({ id: page.id, status: "review_required", reason: "EXECUTION_FAILED" });
    }
  }
  const planned = results.filter(r => r.status === "planned").length;
  return { mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: checked.length, planned, reviewRequired: checked.length - planned, results };
}
