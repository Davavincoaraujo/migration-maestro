import { readFile, stat } from "node:fs/promises";
import { prepareHermesWorkspaces } from "./integrations/hermes-workspace-manager.js";
import { validateTasks } from "./integrations/hermes-task-orchestrator.js";

const [file, checkpoints, workspaces, ...extra] = process.argv.slice(2);
if (!file || !checkpoints || !workspaces || extra.length) {
  console.error("Uso: npm run hermes:workspace -- ./tasks.json ./.maestro-checkpoints ./.maestro-workspaces");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
    const result = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    console.log(JSON.stringify(result, null, 2));
    if (result.blocked.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "WORKSPACE_PREPARATION_FAILED");
    process.exitCode = 1;
  }
}
