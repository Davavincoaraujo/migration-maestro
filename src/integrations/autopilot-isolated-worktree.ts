import { spawn } from "node:child_process";
import { realpath, mkdir, lstat, stat } from "node:fs/promises";
import { resolve, join, relative, sep, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyBoundComponent } from "./component-binding-resolver.js";
import { validateHandoffTask } from "./autopilot-local-handoff.js";
import type { UePatternConfig } from "./local-ue-pattern.js";
function within(root: string, target: string): boolean {
 const rel = relative(root, target);
 return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
async function git(cwd: string, args: string[]): Promise<string> {
 return new Promise((ok, fail) => {
  const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", bytes = 0, settled = false;
  const timer = setTimeout(() => finish(new Error("GIT_TIMEOUT")), 15000);
  function finish(error?: Error) { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); fail(error); } else ok(output.trim()); }
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16000) finish(new Error("GIT_OUTPUT_LIMIT")); else output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16000) finish(new Error("GIT_OUTPUT_LIMIT")); });
  child.on("error", () => finish(new Error("GIT_UNAVAILABLE")));
  child.on("close", code => finish(code === 0 ? undefined : new Error("GIT_COMMAND_FAILED")));
 });
}
/** Explicit local opt-in only. Creates a detached worktree at HEAD, never changes the source worktree. */
export async function createIsolatedWorktree(config: UePatternConfig, componentPath: string, taskValue: unknown, outputRoot: string) {
 const packet = validateHandoffTask(taskValue);
 if (packet.task !== "adapt_component" && packet.task !== "review_reuse") throw new Error("TASK_NOT_READY");
 if (!(await verifyBoundComponent(config, componentPath))) throw new Error("COMPONENT_NOT_VERIFIED");
 const project = await realpath(config.projectDirectory);
 const root = await realpath(resolve(outputRoot));
 if (!(await stat(root)).isDirectory()) throw new Error("INVALID_OUTPUT_DIRECTORY");
 if (within(project, root) || within(root, project)) throw new Error("UNSAFE_WORKTREE_LOCATION");
 const top = await git(project, ["rev-parse", "--show-toplevel"]);
 if (await realpath(top) !== project) throw new Error("PROJECT_NOT_GIT_ROOT");
 const head = await git(project, ["rev-parse", "--verify", "HEAD"]);
 if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("INVALID_GIT_HEAD");
 const worktrees = join(root, "worktrees");
 await mkdir(worktrees, { recursive: true, mode: 0o700 });
 const canonical = await realpath(worktrees);
 if (!within(root, canonical)) throw new Error("UNSAFE_WORKTREE_LOCATION");
 const destination = join(canonical, "maestro-" + randomUUID());
 try { await lstat(destination); throw new Error("WORKTREE_EXISTS"); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
 }
 await git(project, ["worktree", "add", "--detach", "--", destination, head]);
 return { status: "isolated", task: packet.task, baseCommit: head, worktreePath: destination, sourceWorktreeUntouched: true, agentExecuted: false, changesAuthorized: false, publicationAuthorized: false };
}
