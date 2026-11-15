/** Validated planning handoff: metadata only. No commands, code edits or Git operations. */
import { createHash } from "node:crypto";
import { parseAgentPlan, type Plan } from "./maestro-agent-planning.js";

export type PlanningTask = {
  id: Plan["steps"][number]["id"];
  description: string;
  dependsOn: string[];
  status: "awaiting_human_review";
  codeExecutionAuthorized: false;
};
export type PlanningHandoff = {
  schemaVersion: 1;
  kind: "planning-handoff";
  planDigest: string;
  tasks: PlanningTask[];
  requiresHumanReview: true;
  executionAuthorized: false;
};
const order = ["inventory", "mapping", "implementation", "validation", "review"] as const;

/** Accept only an already validated Hermes plan; never infer page routes or components. */
export function createPlanningHandoff(input: unknown): PlanningHandoff {
  const plan = parseAgentPlan(JSON.stringify(input));
  const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return {
    schemaVersion: 1,
    kind: "planning-handoff",
    planDigest: digest,
    tasks: plan.steps.map((step, index) => ({
      id: step.id,
      description: step.description,
      dependsOn: index ? [order[index - 1]] : [],
      status: "awaiting_human_review" as const,
      codeExecutionAuthorized: false as const
    })),
    requiresHumanReview: true,
    executionAuthorized: false
  };
}
