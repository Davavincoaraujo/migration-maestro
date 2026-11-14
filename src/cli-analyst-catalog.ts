import { probeAnalystCatalog, type CatalogRequest } from "./integrations/local-analyst-catalog.js";
const [command, value] = process.argv.slice(2);
try {
  let request: CatalogRequest;
  if (command === "search") request = { tool: "search_component_catalog", query: value ?? "", limit: 5 };
  else if (command === "inspect") request = { tool: "inspect_component", idOrName: value ?? "" };
  else throw new Error("ANALYST_INVALID_COMMAND");
  process.stdout.write(JSON.stringify(await probeAnalystCatalog(process.env.MAESTRO_ANALYTICS_DIR, request), null, 2) + "\n");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  process.stderr.write("Falha no catálogo MCP: " + (/^ANALYST_[A-Z_]+$/.test(message) ? message : "ANALYST_UNKNOWN_ERROR") + "\n");
  process.exitCode = 1;
}
