import { realpath, stat, readFile } from "node:fs/promises";
import { relative, resolve, sep, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { validateHandoffTask } from "./autopilot-local-handoff.js";
import type { TaskPacket } from "./autopilot-task-packet.js";
function within(root: string, path: string) {
 const rel = relative(root, path);
 return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
async function git(cwd: string, args: string[]): Promise<string> {
 return new Promise((ok, fail) => {
  const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  let out = "", size = 0, settled = false;
  const timer = setTimeout(() => done(new Error("GIT_TIMEOUT")), 15000);
  function done(err?: Error) { if (settled) return; settled = true; clearTimeout(timer); if (err) { child.kill(); fail(err); } else ok(out.trim()); }
  child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 16000) done(new Error("GIT_OUTPUT_LIMIT")); else out += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 16000) done(new Error("GIT_OUTPUT_LIMIT")); });
  child.on("error", () => done(new Error("GIT_UNAVAILABLE")));
  child.on("close", code => done(code === 0 ? undefined : new Error("GIT_COMMAND_FAILED")));
 });
}
export interface AgentPreflight {
 status: "ready_for_review"; task: TaskPacket["task"]; isolated: true; clean: true;
 baseCommit: string; agentExecuted: false; codeExecutionAuthorized: false;
 requiresHumanApproval: true; publicationAuthorized: false;
}
/** Verify a detached, clean Maestro worktree before any future agent is launched. */
export async function agentPreflight(worktreePath: string, packetValue: unknown, outputRoot = "./local-output"): Promise<AgentPreflight> {
 const packet = validateHandoffTask(packetValue);
 if (packet.task === "investigate") throw new Error("TASK_NOT_READY");
 const root = await realpath(resolve(outputRoot));
 const expected = await realpath(join(root, "worktrees"));
 const target = await realpath(resolve(worktreePath));
 if (!within(expected, target) || !/^maestro-[a-f0-9-]{36}$/.test(target.split(sep).at(-1) ?? "")) throw new Error("INVALID_WORKTREE_PATH");
 if (!(await stat(target)).isDirectory()) throw new Error("INVALID_WORKTREE_PATH");
 const top = await realpath(await git(target, ["rev-parse", "--show-toplevel"]));
 if (top !== target) throw new Error("NOT_WORKTREE_ROOT");
 const commonPath = await git(target, ["rev-parse", "--git-common-dir"]);
 const common = await realpath(resolve(target, commonPath));
 if (within(target, common) || target === common) throw new Error("NOT_ISOLATED_WORKTREE");
 const branch = await git(target, ["rev-parse", "--abbrev-ref", "HEAD"]);
 if (branch !== "HEAD") throw new Error("WORKTREE_NOT_DETACHED");
 const dirty = await git(target, ["status", "--porcelain", "--untracked-files=all"]);
 if (dirty) throw new Error("WORKTREE_HAS_CHANGES");
 const head = await git(target, ["rev-parse", "--verify", "HEAD"]);
 if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("INVALID_GIT_HEAD");
 return { status: "ready_for_review", task: packet.task, isolated: true, clean: true, baseCommit: head, agentExecuted: false, codeExecutionAuthorized: false, requiresHumanApproval: true, publicationAuthorized: false };
}
export async function agentPreflightFromFile(worktree: string, packetFile: string, root?: string) {
 const file = resolve(packetFile);
 const info = await stat(file);
 if (!info.isFile() || info.size > 16000) throw new Error("INVALID_TASK_FILE");
 return agentPreflight(worktree, JSON.parse(await readFile(file, "utf8")), root);
}
