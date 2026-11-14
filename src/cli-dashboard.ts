import { resolve } from "node:path";
import { startReviewServer } from "./workbench/review-server.js";
async function main(): Promise<void> {
  const directory = resolve(process.argv[2] ?? ".local-maestro/workbench");
  const port = process.argv[3] === undefined ? 4177 : Number(process.argv[3]);
  const server = await startReviewServer(directory, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected server address");
  console.log("Migration Maestro dashboard: http://127.0.0.1:" + address.port);
  console.log("Local-only synthetic review. Press Ctrl+C to stop.");
}
main().catch(() => { console.error("Could not start local dashboard; verify report.json and port."); process.exitCode = 1; });
