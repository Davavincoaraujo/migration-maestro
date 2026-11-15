import { runAgentPlanning } from "./maestro-agent-planning.js";
import { createPlanningHandoff } from "./maestro-planning-handoff.js";

const query = process.argv.slice(2).join(" ").trim();
try {
  const result = await runAgentPlanning(query);
  if (!result.plan) {
    process.stdout.write(JSON.stringify({ ...result, handoff: null }, null, 2) + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({
      analytics: result.analytics,
      uePattern: result.uePattern,
      hermes: result.hermes,
      handoff: createPlanningHandoff(result.plan)
    }, null, 2) + "\n");
  }
} catch {
  process.stderr.write("PLANNING_HANDOFF_FAILED\n");
  process.exitCode = 2;
}
