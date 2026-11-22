import { runCentralDemo } from "./autopilot/central-controller.js";
import { publicPilotWorkflow } from "./autopilot/public-pilot.js";
const [id, flag, ...extra] = process.argv.slice(2);
try {
  if (!id || extra.length || (flag !== undefined && flag !== "--catalog-metadata")) throw Error("Usage: npm run autopilot:pilot -- <20-hex-id> [--catalog-metadata]");
  const result = await runCentralDemo({ id, directory: ".local-maestro/central-demo", workflow: publicPilotWorkflow(flag === "--catalog-metadata"), maxPolls: 30 });
  console.log(JSON.stringify({ jobId: result.jobId, state: result.state, completed: result.completed, publishingAuthorized: false, mergeAuthorized: false }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "PILOT_FAILED"); process.exitCode = 1; }
