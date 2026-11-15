import { readFile, stat } from "node:fs/promises";
import { evaluateHermesReadiness } from "./integrations/hermes-readiness-gate.js";
import { validateTasks } from "./integrations/hermes-task-orchestrator.js";

const [file, directory, ...extra] = process.argv.slice(2);
if (!file || !directory || extra.length) {
  console.error("Uso: npm run hermes:readiness -- ./tasks.json ./.maestro-checkpoints");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
    const report = await evaluateHermesReadiness(tasks, directory);
    console.log(JSON.stringify(report, null, 2));
    if (report.blocked) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "HERMES_READINESS_FAILED");
    process.exitCode = 1;
  }
}
