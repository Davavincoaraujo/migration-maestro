import { probeAnalystContext } from "./integrations/local-analyst-context.js";
try {
  const result = await probeAnalystContext(process.env.MAESTRO_ANALYTICS_DIR);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  process.stderr.write("Falha na chamada MCP: " + (/^ANALYST_[A-Z_]+$/.test(message) ? message : "ANALYST_UNKNOWN_ERROR") + "\n");
  process.exitCode = 1;
}
