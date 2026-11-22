import { readFile } from "node:fs/promises";
import { resumeMigration } from "./autopilot/migration-status.js";
import type { ExecutionAuthorization } from "./autopilot/execution-authorization.js";
try {
  const [id, ...flags] = process.argv.slice(2);
  let authorization: ExecutionAuthorization | undefined;
  if (!id) throw Error("JOB_ID_REQUIRED");
  let approved = false, deferred = false;
  const seen = new Set<string>();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (seen.has(flag)) throw Error("DUPLICATE_ARGUMENT"); seen.add(flag);
    if (flag === "--authorization" && flags[i + 1]) authorization = JSON.parse(await readFile(flags[++i], "utf8"));
    else if (flag === "--continue-after-plan") approved = true;
    else if (flag === "--defer-dispatch") deferred = true;
    else throw Error("INVALID_RESUME_ARGUMENTS");
  }
  if (approved && !authorization) throw Error("EXECUTION_AUTHORIZATION_REQUIRED");
  const result = await resumeMigration(id, { authorization, ...(approved ? {} : { pauseAfter: "PLAN" as const }), ...(deferred ? { executor: "deferred" as const } : {}) });
  console.log(JSON.stringify(result, null, 2));
  if ("blocked" in result && result.blocked) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MIGRATION_RESUME_FAILED"); process.exitCode = 1;
}
