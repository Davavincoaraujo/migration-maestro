import { randomBytes } from "node:crypto";
import { runIsolatedNextPilot } from "./autopilot/isolated-next-pilot.js";
try {
  const [idArg, ...flags] = process.argv.slice(2);
  if (!idArg || flags.length > 1 || flags.some(f => !["--prepare-only", "--pause-after-plan", "--continue-after-plan"].includes(f))) throw Error("Usage: npm run maestro:isolated -- <new|20-hex-job-id> [--prepare-only|--pause-after-plan|--continue-after-plan]");
  const id = idArg === "new" ? randomBytes(10).toString("hex") : idArg;
  const mode = flags.includes("--prepare-only") ? "prepare" : flags.includes("--continue-after-plan") ? "continue" : "plan";
  const result = await runIsolatedNextPilot(".local-maestro/isolated-next", id, mode);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && (/^[A-Z0-9_]+$/.test(error.message) || error.message.startsWith("Usage:")) ? error.message : "ISOLATED_PILOT_FAILED"); process.exitCode = 1;
}
