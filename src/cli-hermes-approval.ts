import { readFile, stat } from "node:fs/promises";
import { validateTasks } from "./integrations/hermes-task-orchestrator.js";
import { approvalStatus, decideApproval } from "./integrations/hermes-approval-gate.js";

const [action, file, directory, taskId, reviewer, ...noteParts] = process.argv.slice(2);
try {
  if (!["status", "approve", "reject"].includes(action ?? "") || !file || !directory ||
      (action === "status" && (taskId || reviewer || noteParts.length)) ||
      (action !== "status" && (!taskId || !reviewer))) throw Error("INVALID_ARGUMENTS");
  const info = await stat(file);
  if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
  const tasks = validateTasks(JSON.parse(await readFile(file, "utf8")));
  const result = action === "status"
    ? await approvalStatus(tasks, directory)
    : await decideApproval(tasks, directory, taskId!, action === "approve" ? "approved" : "rejected",
      reviewer!, noteParts.join(" "));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "APPROVAL_GATE_FAILED");
  process.exitCode = 1;
}
