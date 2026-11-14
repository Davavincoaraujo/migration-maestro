import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan, summarizeMatchingPlan } from "./integrations/component-matching-engine.js";
const query = process.argv.slice(2).join(" ");
if (!query) { process.stderr.write("Uso: npm run analyst:match -- banner\n"); process.exitCode = 1; }
else {
  try {
    const result = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 5 });
    const plan = buildMatchingPlan(result.content);
    process.stdout.write(JSON.stringify({ tool: result.tool, ...summarizeMatchingPlan(plan) }, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Falha no matching: " + (/^ANALYST_[A-Z_]+$/.test(message) ? message : "ANALYST_UNKNOWN_ERROR") + "\n");
    process.exitCode = 1;
  }
}
