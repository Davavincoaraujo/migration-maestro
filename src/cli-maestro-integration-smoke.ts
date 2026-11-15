import { runIntegrationSmoke } from "./maestro-integration-smoke.js";

const query = process.argv.slice(2).join(" ").trim();
try {
  const result = await runIntegrationSmoke(query);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ready) process.exitCode = 1;
} catch {
  process.stderr.write("INTEGRATION_SMOKE_INVALID_INPUT\n");
  process.exitCode = 2;
}
