import { inspectNestedEvidence } from "./integrations/component-nested-inspection.js";
const query = process.argv.slice(2).join(" ");
if (!query) { process.stderr.write("Uso: npm run analyst:evidence-arrays -- banner\n"); process.exitCode = 1; }
else {
  try {
    const report = await inspectNestedEvidence(process.env.MAESTRO_ANALYTICS_DIR, query);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Falha na análise: " + (/^ANALYST_[A-Z_]+$/.test(message) ? message : "ANALYST_UNKNOWN_ERROR") + "\n");
    process.exitCode = 1;
  }
}
