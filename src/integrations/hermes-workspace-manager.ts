import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { evaluateHermesReadiness } from "./hermes-readiness-gate.js";
import { validateTasks, type TaskInput } from "./hermes-task-orchestrator.js";

export type WorkspaceManifest = {
  schemaVersion: 1;
  mode: "preparation-only";
  taskId: string;
  route: string;
  components: string[];
  dependsOn: string[];
  specificationDigest: string;
  codeExecutionAuthorized: false;
  publishingAuthorized: false;
};
export type WorkspaceResult = {
  mode: "preparation-only";
  codeExecutionAuthorized: false;
  publishingAuthorized: false;
  prepared: number;
  reused: number;
  blocked: { id: string; reasons: string[] }[];
  workspaces: { id: string; path: string; status: "created" | "reused" }[];
};
function hash(task: TaskInput): string {
  return createHash("sha256").update(JSON.stringify(task)).digest("hex");
}
function manifest(task: TaskInput): WorkspaceManifest {
  return {
    schemaVersion: 1, mode: "preparation-only", taskId: task.id,
    route: task.route, components: [...task.components], dependsOn: [...task.dependsOn],
    specificationDigest: hash(task),
    codeExecutionAuthorized: false, publishingAuthorized: false
  };
}
async function ensureRealDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error("UNSAFE_WORKSPACE_PATH");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
  }
}
async function verifyManifest(path: string, expected: WorkspaceManifest): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw Error("UNSAFE_WORKSPACE_MANIFEST");
  const actual: unknown = JSON.parse(await readFile(path, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error("WORKSPACE_MANIFEST_MISMATCH");
}
/** Prepares metadata-only workspaces. Never runs agents, shell commands, git or code generation. */
export async function prepareHermesWorkspaces(
  input: TaskInput[], checkpointDirectory: string, workspaceDirectory: string
): Promise<WorkspaceResult> {
  const tasks = validateTasks(input);
  const readiness = await evaluateHermesReadiness(tasks, checkpointDirectory);
  const blocked = readiness.tasks.filter(t => t.status === "blocked")
    .map(t => ({ id: t.id, reasons: t.reasons }));
  const base = resolve(workspaceDirectory);
  // Require an existing, non-symlink parent; do not recursively follow a user-provided path.
  const parent = resolve(base, "..");
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw Error("UNSAFE_WORKSPACE_PARENT");
  await ensureRealDirectory(base);
  const workspaces: WorkspaceResult["workspaces"] = [];
  for (const task of tasks) {
    if (blocked.some(b => b.id === task.id)) continue;
    const taskPath = join(base, task.id + "-" + hash(task).slice(0, 12));
    await ensureRealDirectory(taskPath);
    const target = join(taskPath, "manifest.json");
    const data = manifest(task);
    let status: "created" | "reused" = "created";
    try {
      await writeFile(target, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyManifest(target, data);
      status = "reused";
    }
    workspaces.push({ id: task.id, path: taskPath, status });
  }
  return {
    mode: "preparation-only", codeExecutionAuthorized: false, publishingAuthorized: false,
    prepared: workspaces.filter(w => w.status === "created").length,
    reused: workspaces.filter(w => w.status === "reused").length,
    blocked, workspaces
  };
}
