import { pathToFileURL } from "node:url";
import { runCentralDemo } from "./autopilot/central-controller.js";
export async function centralCli(args: string[], discoverSessions?: Parameters<typeof runCentralDemo>[0]["discoverSessions"]) {
const [id, ...extra] = args;
try {
  if (!id || extra.some(arg => !["--defer-dispatch", "--pause-after-analyze", "--pause-after-map-components", "--pause-after-plan", "--synthetic-mapping-v1"].includes(arg)) || new Set(extra).size !== extra.length) throw Error("Usage: npm run autopilot:central -- <20-character-hex-job-id> [--defer-dispatch] [--pause-after-analyze | --pause-after-map-components | --pause-after-plan] [--synthetic-mapping-v1]");
  if (["--pause-after-analyze", "--pause-after-map-components", "--pause-after-plan"].filter(flag => extra.includes(flag)).length > 1) throw Error("CONFLICTING_PAUSE_FLAGS");
  const pause = extra.includes("--pause-after-plan") ? "PLAN" as const : extra.includes("--pause-after-map-components") ? "MAP_COMPONENTS" as const : extra.includes("--pause-after-analyze") ? "ANALYZE" as const : undefined;
  const result = await runCentralDemo({ discoverSessions, id, directory: ".local-maestro/central-demo", ...(extra.includes("--defer-dispatch") ? { executor: "deferred" as const } : {}), ...(pause ? { pauseAfter: pause } : {}), ...(extra.includes("--synthetic-mapping-v1") ? { syntheticMappingContract: true } : {}) });
  console.log(JSON.stringify({ jobId: result.jobId, state: result.state, completed: result.completed, ...(pause ? { paused: true, pauseAfter: pause } : {}), humanApprovalRequired: true, publishingAuthorized: false, mergeAuthorized: false }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "CENTRAL_CONTROLLER_FAILED"); process.exitCode = 1; }

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await centralCli(process.argv.slice(2));
