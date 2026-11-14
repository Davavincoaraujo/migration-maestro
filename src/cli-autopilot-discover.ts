import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validateRequirements } from "./integrations/component-compatibility.js";
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan } from "./integrations/component-matching-engine.js";
const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) {
 process.stderr.write("Uso: npm run autopilot:discover -- ./requirements.local.json\n");
 process.exitCode = 1;
} else {
 try {
  const info = await stat(resolve(file));
  if (!info.isFile() || info.size > 16000) throw new Error("INVALID_REQUIREMENTS_FILE");
  const requirements = validateRequirements(JSON.parse(await readFile(resolve(file), "utf8")));
  const results = [];
  for (const capability of requirements.capabilities) {
   const catalog = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query: capability, limit: 5 });
   const plan = buildMatchingPlan(catalog.content);
   results.push({ capability, candidateCount: plan.candidates.length, candidates: plan.candidates.map(c => ({ score: c.score, recommendation: "inspect" })) });
  }
  process.stdout.write(JSON.stringify({ status: "discovery_only", requirements: requirements.capabilities.length, results, codeExecutionAuthorized: false, humanReviewRequired: true }, null, 2) + "\n");
 } catch (error) {
  const message = error instanceof Error ? error.message : "";
  process.stderr.write("Descoberta bloqueada: " + (/^[A-Z_]+$/.test(message) ? message : "DISCOVERY_FAILED") + "\n");
  process.exitCode = 2;
 }
}
