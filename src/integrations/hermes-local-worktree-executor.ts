import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { planHermesGitWorkspaces } from "./hermes-git-workspace-adapter.js";
import type { TaskInput } from "./hermes-task-orchestrator.js";

const exec = promisify(execFile);
const hashPattern = /^[a-f0-9]{40}$/;
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd, timeout: 15000, maxBuffer: 128 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_NOSYSTEM: "1" }
  });
  return stdout.trim();
}
async function directory(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("UNSAFE_DIRECTORY");
  return realpath(path);
}
export type LocalWorktreeResult = {
  mode: "local-worktree";
  executed: boolean;
  codeExecutionAuthorized: false;
  mergeAuthorized: false;
  publishingAuthorized: false;
  taskId: string;
  branch: string;
  path: string;
  baseCommit: string;
  status: "planned" | "created";
};
/** One task per invocation. Only local branch and worktree creation; never merge/push/deploy. */
export async function prepareLocalWorktree(
  tasks: TaskInput[], checkpoints: string, workspaces: string,
  portalDirectory: string, outputDirectory: string, taskId: string,
  baseCommit: string, execute = false
): Promise<LocalWorktreeResult> {
  if (!hashPattern.test(baseCommit)) throw Error("BASE_SHA_REQUIRED");
  const plan = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
  const task = plan.tasks.find(t => t.id === taskId);
  if (!task || task.status !== "planned" || !task.branch) throw Error("TASK_NOT_READY");
  const portal = await directory(resolve(portalDirectory));
  const top = await git(portal, "rev-parse", "--show-toplevel");
  if (await realpath(top) !== portal) throw Error("NOT_REPOSITORY_ROOT");
  if (await git(portal, "branch", "--show-current") !== "main") throw Error("PORTAL_MAIN_REQUIRED");
  const head = await git(portal, "rev-parse", "--verify", "refs/heads/main^{commit}");
  if (head !== baseCommit) throw Error("BASE_SHA_CHANGED");
  const output = resolve(outputDirectory);
  if (output === portal || output.startsWith(portal + sep)) throw Error("OUTPUT_INSIDE_PORTAL");
  // Parent must already exist and be a real directory; do not follow an output symlink.
  const parent = await directory(dirname(output));
  if (resolve(parent, basename(output)) === portal) throw Error("UNSAFE_OUTPUT");
  const outputInfo = await lstat(output).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (outputInfo && (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()))
    throw Error("UNSAFE_OUTPUT");
  const destination = join(output, task.branch.replaceAll("/", "-"));
  const existing = await lstat(destination).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (existing) throw Error("WORKTREE_PATH_EXISTS");
  const exists = await git(portal, "show-ref", "--verify", "--quiet", "refs/heads/" + task.branch)
    .then(() => true).catch(() => false);
  if (exists) throw Error("BRANCH_EXISTS");
  const result: LocalWorktreeResult = {
    mode: "local-worktree", executed: execute,
    codeExecutionAuthorized: false, mergeAuthorized: false, publishingAuthorized: false,
    taskId, branch: task.branch, path: destination, baseCommit,
    status: execute ? "created" : "planned"
  };
  if (!execute) return result;
  // This operation mutates local git metadata only, after an explicit per-task opt-in.
  if (!outputInfo) await mkdir(output, { mode: 0o700 });
  const lockPath = join(output, ".maestro-worktree.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "EEXIST") throw Error("WORKTREE_EXECUTOR_BUSY");
    throw e;
  });
  try {
    // Re-check after obtaining the lock; another actor may have changed main or branch.
    if (await git(portal, "rev-parse", "refs/heads/main^{commit}") !== baseCommit)
      throw Error("BASE_SHA_CHANGED");
    const branchExists = await git(portal, "show-ref", "--verify", "--quiet", "refs/heads/" + task.branch)
      .then(() => true).catch(() => false);
    if (branchExists) throw Error("BRANCH_EXISTS");
    await lstat(destination).then(() => { throw Error("WORKTREE_PATH_EXISTS"); },
      (e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
    await git(portal, "worktree", "add", "-b", task.branch, destination, baseCommit);
    const audit = join(output, ".maestro-worktree-audit.jsonl");
    await writeFile(audit, JSON.stringify({
      at: new Date().toISOString(), action: "worktree-created", taskId,
      branch: task.branch, path: destination, baseCommit
    }) + "\n", { flag: "a", mode: 0o600 });
    return result;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
