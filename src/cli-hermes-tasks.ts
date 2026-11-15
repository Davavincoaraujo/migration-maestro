import { readFile, stat } from "node:fs/promises";
import { orchestrateHermesTasks, validateTasks } from "./integrations/hermes-task-orchestrator.js";
const [file, directory, ...extra] = process.argv.slice(2);
if (!file || !directory || extra.length) {
  console.error("Uso: npm run hermes:tasks -- ./tasks.json ./.maestro-checkpoints");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
    const result = await orchestrateHermesTasks(tasks, directory);
    console.log(JSON.stringify(result, null, 2));
    if (result.tasks.some(t => t.status !== "completed")) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error && error.message === "ORCHESTRATION_ALREADY_RUNNING"
      ? "ORCHESTRATION_ALREADY_RUNNING" : "HERMES_TASKS_FAILED");
    process.exitCode = 1;
  }
}
