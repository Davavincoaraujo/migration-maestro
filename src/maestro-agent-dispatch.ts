/** Safe dispatch preview. This does not execute agents, tools, git, or AEM operations. */
import { createPlanningHandoff, type PlanningHandoff } from "./maestro-planning-handoff.js";
import { parseAgentPlan } from "./maestro-agent-planning.js";

export type DispatchAssignment = {
  taskId: string;
  agent: "analytics" | "ue-pattern" | "hermes" | "validator" | "human-review";
  dependsOn: string[];
  status: "blocked_pending_approval";
  executionAuthorized: false;
};
export type DispatchPreview = {
  schemaVersion: 1;
  kind: "agent-dispatch-preview";
  planDigest: string;
  assignments: DispatchAssignment[];
  requiresHumanReview: true;
  executionAuthorized: false;
  gitWritesAuthorized: false;
  publishingAuthorized: false;
};
const agents = ["analytics", "ue-pattern", "hermes", "validator", "human-review"] as const;

/** Derive dispatch only from a strict original Hermes plan, not a mutable task packet. */
export function createDispatchPreview(rawPlan: unknown): DispatchPreview {
  const validated = parseAgentPlan(JSON.stringify(rawPlan));
  const handoff: PlanningHandoff = createPlanningHandoff(validated);
  return {
    schemaVersion: 1,
    kind: "agent-dispatch-preview",
    planDigest: handoff.planDigest,
    assignments: handoff.tasks.map((task, index) => ({
      taskId: task.id,
      agent: agents[index],
      dependsOn: [...task.dependsOn],
      status: "blocked_pending_approval" as const,
      executionAuthorized: false as const
    })),
    requiresHumanReview: true,
    executionAuthorized: false,
    gitWritesAuthorized: false,
    publishingAuthorized: false
  };
}
