import { readFile, stat } from "node:fs/promises";
import { prepareLocalWorktree } from "./integrations/hermes-local-worktree-executor.js";
import { validateTasks } from "./integrations/hermes-task-orchestrator.js";

const [file, checkpoints, workspaces, portal, output, taskId, sha, flag, ...extra] = process.argv.slice(2);
if (!file || !checkpoints || !workspaces || !portal || !output || !taskId || !sha ||
    extra.length || (flag !== undefined && flag !== "--execute")) {
  console.error("Uso: npm run hermes:local-worktree -- ./tasks.json ./.maestro-checkpoints ./.maestro-workspaces ~/Developer/iibr-fed-portalbradesco ./local-output/hermes-worktrees TASK_ID BASE_SHA [--execute]");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
    console.log(JSON.stringify(await prepareLocalWorktree(
      tasks, checkpoints, workspaces, portal, output, taskId, sha, flag === "--execute"
    ), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "LOCAL_WORKTREE_FAILED");
    process.exitCode = 1;
  }
}
