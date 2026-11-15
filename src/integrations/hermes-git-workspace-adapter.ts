import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { evaluateHermesReadiness } from "./hermes-readiness-gate.js";
import { validateTasks, type TaskInput } from "./hermes-task-orchestrator.js";
import type { WorkspaceManifest } from "./hermes-workspace-manager.js";

export type GitBranchPlan = {
  id: string;
  status: "planned" | "blocked";
  branch: string | null;
  workspace: string | null;
  specificationDigest: string;
  reasons: string[];
};
export type GitWorkspacePlan = {
  mode: "git-plan-only";
  gitOperationsPerformed: false;
  codeExecutionAuthorized: false;
  publishingAuthorized: false;
  total: number;
  planned: number;
  blocked: number;
  tasks: GitBranchPlan[];
};
function digest(task: TaskInput): string {
  return createHash("sha256").update(JSON.stringify(task)).digest("hex");
}
function expectedManifest(task: TaskInput): WorkspaceManifest {
  return {
    schemaVersion: 1, mode: "preparation-only", taskId: task.id,
    route: task.route, components: [...task.components], dependsOn: [...task.dependsOn],
    specificationDigest: digest(task), codeExecutionAuthorized: false,
    publishingAuthorized: false
  };
}
async function verifyWorkspace(path: string, expected: WorkspaceManifest): Promise<boolean> {
  try {
    const dir = await lstat(path);
    if (!dir.isDirectory() || dir.isSymbolicLink()) return false;
    const file = join(path, "manifest.json");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) return false;
    const actual: unknown = JSON.parse(await readFile(file, "utf8"));
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
/** Read-only plan. Does not invoke git, shell commands, agents or GitHub APIs. */
export async function planHermesGitWorkspaces(
  input: TaskInput[], checkpointDirectory: string, workspaceDirectory: string
): Promise<GitWorkspacePlan> {
  const tasks = validateTasks(input);
  const readiness = await evaluateHermesReadiness(tasks, checkpointDirectory);
  const root = resolve(workspaceDirectory);
  const rootStat = await lstat(root).catch(() => null);
  const safeRoot = !!rootStat && rootStat.isDirectory() && !rootStat.isSymbolicLink();
  const tasksOut: GitBranchPlan[] = [];
  for (const task of tasks) {
    const spec = digest(task);
    const ready = readiness.tasks.find(t => t.id === task.id)!;
    const reasons = [...ready.reasons];
    const workspace = join(root, task.id + "-" + spec.slice(0, 12));
    if (!safeRoot || !(await verifyWorkspace(workspace, expectedManifest(task))))
      reasons.push("WORKSPACE_NOT_VERIFIED");
    tasksOut.push({
      id: task.id,
      status: reasons.length ? "blocked" : "planned",
      branch: reasons.length ? null : "maestro/" + task.id + "-" + spec.slice(0, 12),
      workspace: reasons.length ? null : workspace,
      specificationDigest: spec,
      reasons
    });
  }
  const planned = tasksOut.filter(t => t.status === "planned").length;
  return {
    mode: "git-plan-only", gitOperationsPerformed: false,
    codeExecutionAuthorized: false, publishingAuthorized: false,
    total: tasksOut.length, planned, blocked: tasksOut.length - planned, tasks: tasksOut
  };
}
