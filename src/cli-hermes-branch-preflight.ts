import { readFile, stat } from "node:fs/promises";
import { preflightHermesBranches } from "./integrations/hermes-git-branch-executor.js";
import { validateTasks } from "./integrations/hermes-task-orchestrator.js";

const [file, checkpoints, workspaces, target, baseRef = "HEAD", ...extra] = process.argv.slice(2);
if (!file || !checkpoints || !workspaces || !target || extra.length) {
  console.error("Uso: npm run hermes:branch-preflight -- ./tasks.json ./.maestro-checkpoints ./.maestro-workspaces ./demo-repo [HEAD]");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
    const result = await preflightHermesBranches(tasks, checkpoints, workspaces, target, baseRef);
    console.log(JSON.stringify(result, null, 2));
    if (result.blocked) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "BRANCH_PREFLIGHT_FAILED");
    process.exitCode = 1;
  }
}
