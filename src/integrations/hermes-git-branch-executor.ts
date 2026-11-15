import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { planHermesGitWorkspaces } from "./hermes-git-workspace-adapter.js";
import type { TaskInput } from "./hermes-task-orchestrator.js";

const run = promisify(execFile);
export type BranchPreflight = {
  mode: "dry-run";
  gitOperationsPerformed: false;
  codeExecutionAuthorized: false;
  publishingAuthorized: false;
  target: string;
  baseRef: string;
  baseCommit: string | null;
  total: number;
  ready: number;
  blocked: number;
  tasks: { id: string; branch: string | null; status: "ready" | "blocked"; reasons: string[] }[];
};
async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run("git", args, { cwd, timeout: 5000, maxBuffer: 64 * 1024, env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1"
  } });
  return result.stdout.trim();
}
function isHash(s: string): boolean { return /^[a-f0-9]{40}$/.test(s); }
/**
 * Read-only preflight for an explicitly marked, standalone demo repository.
 * No branch creation, checkout, push, agent execution or publication.
 */
export async function preflightHermesBranches(
  tasks: TaskInput[], checkpoints: string, workspaces: string, targetDirectory: string,
  baseRef = "HEAD"
): Promise<BranchPreflight> {
  if (!/^(HEAD|refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/.test(baseRef) ||
      baseRef.includes("..") || baseRef.includes("//") || baseRef.endsWith(".lock"))
    throw Error("INVALID_BASE_REF");
  const plan = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
  const target = resolve(targetDirectory);
  // macOS may resolve /var to /private/var; reject only a symlink at the repository directory itself.
  const targetInfo = await lstat(target);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())
    throw Error("TARGET_SYMLINK_NOT_ALLOWED");
  const root = await realpath(target);
  const marker = join(root, ".maestro-demo-repo");
  const info = await lstat(marker).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink()) throw Error("DEMO_REPOSITORY_MARKER_REQUIRED");
  const top = await git(root, "rev-parse", "--show-toplevel");
  if (await realpath(top) !== root) throw Error("TARGET_MUST_BE_REPOSITORY_ROOT");
  const bare = await git(root, "rev-parse", "--is-bare-repository");
  if (bare !== "false") throw Error("BARE_REPOSITORY_NOT_SUPPORTED");
  const status = await git(root, "status", "--porcelain", "--untracked-files=all");
  const clean = status.split("\n").filter(Boolean).every(line => line === "?? .maestro-demo-repo");
  const baseCommit = await git(root, "rev-parse", "--verify", baseRef + "^{commit}").catch(() => "");
  if (!isHash(baseCommit)) throw Error("BASE_COMMIT_NOT_FOUND");
  const rows: BranchPreflight["tasks"] = [];
  for (const task of plan.tasks) {
    const reasons = [...task.reasons];
    if (!clean) reasons.push("TARGET_NOT_CLEAN");
    if (task.branch) {
      const exists = await git(root, "show-ref", "--verify", "--quiet", "refs/heads/" + task.branch)
        .then(() => true).catch(() => false);
      if (exists) reasons.push("BRANCH_ALREADY_EXISTS");
    }
    rows.push({ id: task.id, branch: task.branch, status: reasons.length ? "blocked" : "ready", reasons });
  }
  const ready = rows.filter(row => row.status === "ready").length;
  return {
    mode: "dry-run", gitOperationsPerformed: false,
    codeExecutionAuthorized: false, publishingAuthorized: false,
    target: root, baseRef, baseCommit, total: rows.length,
    ready, blocked: rows.length - ready, tasks: rows
  };
}
