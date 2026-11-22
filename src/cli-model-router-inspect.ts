import { inspectModelRouter } from "./integrations/model-router-inspection.js";

try {
  const result = await inspectModelRouter();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.maestri.state !== "connected") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  process.stderr.write((/^[A-Z0-9_]+$/.test(message) ? message : "MODEL_ROUTER_INSPECTION_FAILED") + "\n");
  process.exitCode = 1;
}
