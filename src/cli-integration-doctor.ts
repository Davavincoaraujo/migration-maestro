import { inspectLocalIntegrations } from "./core/integration/doctor.js";

try {
  const report = await inspectLocalIntegrations();
  console.log(JSON.stringify(report, null, 2));
  if (!report.maestri.installed || !report.hermes.cliAvailable) process.exitCode = 1;
} catch {
  console.error("INTEGRATION_DIAGNOSTIC_FAILED");
  process.exitCode = 1;
}
