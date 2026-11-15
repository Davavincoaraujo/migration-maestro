import { runAgentPlanning } from "./maestro-agent-planning.js";
import { createPlanningHandoff } from "./maestro-planning-handoff.js";
import { createDispatchPreview } from "./maestro-agent-dispatch.js";

const query = process.argv.slice(2).join(" ").trim();
try {
  const result = await runAgentPlanning(query);
  if (!result.plan) {
    console.log(JSON.stringify({ ...result, handoff: null, dispatch: null }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      analytics: result.analytics,
      uePattern: result.uePattern,
      hermes: result.hermes,
      handoff: createPlanningHandoff(result.plan),
      dispatch: createDispatchPreview(result.plan)
    }, null, 2));
  }
} catch {
  console.error("AGENT_DISPATCH_INVALID_INPUT");
  process.exitCode = 2;
}
