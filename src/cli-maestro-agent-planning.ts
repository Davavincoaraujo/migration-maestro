import { runAgentPlanning } from "./maestro-agent-planning.js";
const query = process.argv.slice(2).join(" ").trim();
try {
  const result = await runAgentPlanning(query);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.plan) process.exitCode = 1;
} catch {
  process.stderr.write("AGENT_PLANNING_INVALID_INPUT\n");
  process.exitCode = 2;
}
