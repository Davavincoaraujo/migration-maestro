import { runClaudeInWorktree } from "./integrations/autopilot-claude-executor.js";
const [worktree, packet, component, flag, requirementsFlag, requirementsFile, ...extra] = process.argv.slice(2);
if (!worktree || !packet || !component || flag !== "--execute" || extra.length || (requirementsFlag !== undefined && (requirementsFlag !== "--requirements" || !requirementsFile))) {
 process.stderr.write("Uso: npm run autopilot:execute -- <worktree> <packet.json> <componentPath> --execute --requirements ./requirements.local.json\n");
 process.exitCode = 1;
} else {
 try {
  const result = await runClaudeInWorktree(worktree, packet, component, { execute: true, requirementsFile });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
 } catch (e) {
  const msg = e instanceof Error ? e.message : "";
  process.stderr.write("Executor bloqueado: " + (/^[A-Z_]+$/.test(msg) ? msg : "EXECUTION_FAILED") + "\n");
  process.exitCode = 2;
 }
}
