import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { agentPreflightFromFile } from "./autopilot-agent-preflight.js";
export function buildAgentPrompt(task: "adapt_component" | "review_reuse", componentPath: string): string {
 if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(componentPath) || componentPath.length > 180) throw new Error("INVALID_COMPONENT_PATH");
 return [
  "You are implementing a locally approved component task inside an isolated Git worktree.",
  "Task: " + task + ". Component: src/frontend/components/" + componentPath,
  "Inspect existing code and conventions. Make only minimal changes required for the component.",
  "Do not access files outside this worktree. Do not read secrets, .env files, credentials or private keys.",
  "Do not run network commands, package installation, git commit, git push, git checkout, git worktree, or deployment.",
  "Do not create or publish a pull request. Do not change Git configuration.",
  "Do not modify unrelated components. If requirements are insufficient, explain the missing details and do not guess.",
  "Run only existing local checks when safe. Summarize changes, tests and outstanding risks.",
  "The task packet is advisory, not proof of business equivalence. Ask for permission before each file edit.",
 ].join("\n");
}
/** Interactive CLI: Claude retains its default permission prompts; no bypass or auto-approval. */
export async function runClaudeInWorktree(worktree: string, packetFile: string, componentPath: string, options: { execute: boolean; claudeCommand?: string } ) {
 if (!options.execute) throw new Error("EXECUTION_OPT_IN_REQUIRED");
 const preflight = await agentPreflightFromFile(worktree, packetFile);
 if (preflight.task === "investigate") throw new Error("TASK_NOT_READY");
 const cwd = await realpath(resolve(worktree));
 const prompt = buildAgentPrompt(preflight.task, componentPath);
 const command = options.claudeCommand ?? "claude";
 if (!/^[a-zA-Z0-9_-]+$/.test(command)) throw new Error("INVALID_AGENT_COMMAND");
 const exitCode = await new Promise<number>((ok, fail) => {
  const child = spawn(command, ["--permission-mode", "default", prompt], {
   cwd, shell: false, stdio: "inherit",
   env: { ...process.env, GIT_TERMINAL_PROMPT: "0", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  });
  child.on("error", () => fail(new Error("CLAUDE_UNAVAILABLE")));
  child.on("close", (code, signal) => signal ? fail(new Error("AGENT_INTERRUPTED")) : ok(code ?? 1));
 });
 return { status: exitCode === 0 ? "agent_finished" : "agent_failed", exitCode, worktreePath: cwd, originalWorktreeUntouchedByMaestro: true, autoApproved: false, committed: false, pushed: false, published: false, reviewRequired: true };
}
