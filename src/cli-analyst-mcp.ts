import { discoverAnalystTools } from "./integrations/local-analyst-mcp.js";
try {
  const tools = await discoverAnalystTools(process.env.MAESTRO_ANALYTICS_DIR, process.argv.includes("--schemas"));
  process.stdout.write(JSON.stringify({ server: "migration-context", toolCount: tools.length, tools }, null, 2) + "\n");
} catch (error) {
  const code = error instanceof Error ? error.message : "ANALYST_UNKNOWN_ERROR";
  process.stderr.write("Falha no MCP Analyst: " + (/^ANALYST_[A-Z_]+$/.test(code) ? code : "ANALYST_UNKNOWN_ERROR") + "\n");
  process.exitCode = 1;
}
