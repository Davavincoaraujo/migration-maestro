import { agentPreflightFromFile } from "./integrations/autopilot-agent-preflight.js";
const [worktree, packet, ...extra] = process.argv.slice(2);
if (!worktree || !packet || extra.length) {
 process.stderr.write("Uso: npm run autopilot:agent-preflight -- <worktreePath> ./local-output/task-packet-1.json\n");
 process.exitCode = 1;
} else {
 try { process.stdout.write(JSON.stringify(await agentPreflightFromFile(worktree, packet), null, 2) + "\n"); }
 catch (e) { const message = e instanceof Error ? e.message : ""; process.stderr.write("Preflight bloqueado: " + (/^[A-Z_]+$/.test(message) ? message : "PREFLIGHT_FAILED") + "\n"); process.exitCode = 2; }
}
