import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan } from "./integrations/component-matching-engine.js";
import { assessCompatibility, validateRequirements } from "./integrations/component-compatibility.js";
import { evaluateUeValidationGate } from "./integrations/ue-validation-gate.js";
import { buildAutopilotAdvisoryPlan } from "./integrations/autopilot-advisory-plan.js";
const [query, requirementsFile, componentPath, ...extra] = process.argv.slice(2);
if (!query || query.length > 120 || !requirementsFile || !componentPath || extra.length ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(componentPath) || componentPath.length > 180) {
  process.stderr.write("Uso: npm run autopilot:plan -- banner ./requirements.local.json principal/sections/banner-service/v1\n");
  process.exitCode = 1;
} else {
  try {
    const path = resolve(requirementsFile);
    const info = await stat(path);
    if (!info.isFile() || info.size > 16000) throw new Error("INVALID_REQUIREMENTS_FILE");
    const requirements = validateRequirements(JSON.parse(await readFile(path, "utf8")));
    const catalog = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 5 });
    const candidates = buildMatchingPlan(catalog.content).candidates.slice(0, 3);
    const gate = await evaluateUeValidationGate(componentPath);
    const plans = [];
    for (const candidate of candidates) {
      try {
        const evidence = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "inspect_component", idOrName: candidate.id });
        plans.push(buildAutopilotAdvisoryPlan(assessCompatibility(requirements, evidence.content), gate));
      } catch {
        plans.push(buildAutopilotAdvisoryPlan({
          decision: "insufficient_evidence", status: "review_required",
          required: requirements.capabilities.length + requirements.variants.length + requirements.fieldTypes.length,
          matched: 0, missing: requirements.capabilities.length + requirements.variants.length + requirements.fieldTypes.length,
          unsupportedEvidence: true,
        }, gate));
      }
    }
    process.stdout.write(JSON.stringify({
      status: "review_required", assessed: plans.length,
      uePathAssociation: "unverified", humanApprovalRequired: true,
      codeExecutionAuthorized: false, plans,
    }, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Falha no planejamento: " + (/^(ANALYST_|INVALID_|EMPTY_)[A-Z_]+$/.test(message) ? message : "AUTOPILOT_PLAN_FAILED") + "\n");
    process.exitCode = 1;
  }
}
