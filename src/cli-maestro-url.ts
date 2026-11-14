import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { analyzeUrlViaMcp, validatePageUrl } from "./integrations/url-analysis-orchestrator.js";
const [command, url, ...flags] = process.argv.slice(2);
if (command !== "migrate" || !url || flags.length) {
 process.stderr.write('Uso: npm run maestro -- migrate "https://exemplo.com/pagina"\n');
 process.exitCode = 1;
} else {
 try {
  const validated = validatePageUrl(url);
  const runId = randomUUID();
  const dir = resolve("local-output", "runs", runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stages = [
   { name: "validate_url", status: "completed" },
   { name: "migration_analyst", status: "pending" },
   { name: "plan_tasks", status: "pending" },
   { name: "implement", status: "approval_required" },
   { name: "validate", status: "pending" },
   { name: "pull_request", status: "approval_required" },
  ];
  const checkpoint = async () => {
   const report = { schemaVersion: 1, runId, urlFingerprint: createHash("sha256").update(validated).digest("hex").slice(0, 16),
    status: stages[1].status === "completed" ? "review_required" : stages[1].status, stages, codeExecuted: false, published: false };
   const pending = join(dir, "state.pending.json");
   await writeFile(pending, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
   await rename(pending, join(dir, "state.json"));
   return report;
  };
  await checkpoint();
  try {
   const result = await analyzeUrlViaMcp(process.env.MAESTRO_ANALYTICS_DIR, validated);
   stages[1].status = result.stage === "analyzed" ? "completed" : "blocked";
   stages[2].status = result.stage === "analyzed" ? "review_required" : "blocked";
   const report = await checkpoint();
   process.stdout.write(JSON.stringify({ ...report, analystTool: result.tool, analystResultBlocks: result.content.length, ...(result.reason ? { reason: result.reason } : {}) }, null, 2) + "\n");
   if (result.stage !== "analyzed") process.exitCode = 2;
  } catch (error) {
   stages[1].status = "failed";
   stages[2].status = "blocked";
   await checkpoint();
   throw error;
  }
 } catch (error) {
  const message = error instanceof Error ? error.message : "MAESTRO_FAILED";
  process.stderr.write("Maestro bloqueado: " + (/^[A-Z_]+$/.test(message) ? message : "MAESTRO_FAILED") + "\n");
  process.exitCode = 2;
 }
}
