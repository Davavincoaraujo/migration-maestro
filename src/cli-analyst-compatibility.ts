import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan } from "./integrations/component-matching-engine.js";
import { assessCompatibility, validateRequirements } from "./integrations/component-compatibility.js";
const [query, requirementsPath] = process.argv.slice(2);
if (!query || !requirementsPath) {
  process.stderr.write("Uso: npm run analyst:compatibility -- banner ./requirements.local.json\n");
  process.exitCode = 1;
} else {
  try {
    const path = resolve(requirementsPath);
    const stat = await import("node:fs/promises").then(fs => fs.stat(path));
    if (!stat.isFile() || stat.size > 16000) throw new Error("INVALID_REQUIREMENTS_FILE");
    const requirements = validateRequirements(JSON.parse(await readFile(path, "utf8")));
    const catalog = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 5 });
    const candidates = buildMatchingPlan(catalog.content).candidates.slice(0, 3);
    const assessments = [];
    for (const candidate of candidates) {
      try {
        const response = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "inspect_component", idOrName: candidate.id });
        assessments.push(assessCompatibility(requirements, response.content));
      } catch {
        assessments.push({ decision: "insufficient_evidence", status: "review_required", required: requirements.capabilities.length + requirements.variants.length + requirements.fieldTypes.length, matched: 0, missing: requirements.capabilities.length + requirements.variants.length + requirements.fieldTypes.length, unsupportedEvidence: true });
      }
    }
    process.stdout.write(JSON.stringify({ status: "review_required", discovered: buildMatchingPlan(catalog.content).candidates.length, assessed: assessments.length, assessments, nextAction: "human_review_and_ue_pattern_validation" }, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Falha na avaliação: " + (/^(ANALYST_|INVALID_|EMPTY_)[A-Z_]+$/.test(message) ? message : "COMPATIBILITY_FAILED") + "\n");
    process.exitCode = 1;
  }
}
