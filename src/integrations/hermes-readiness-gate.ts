import { approvalStatus } from "./hermes-approval-gate.js";
import { validateTasks, type TaskInput } from "./hermes-task-orchestrator.js";

export type ReadinessStatus = "ready_for_isolated_preparation" | "blocked";
export type ReadinessTask = {
  id: string;
  status: ReadinessStatus;
  reasons: string[];
  dependencies: string[];
  planningStatus: string;
  approval: string;
};
export type ReadinessReport = {
  mode: "readiness-only";
  codeExecutionAuthorized: false;
  publishingAuthorized: false;
  total: number;
  ready: number;
  blocked: number;
  tasks: ReadinessTask[];
};

/** Read-only evaluation: approval does not grant execution or publishing permissions. */
export async function evaluateHermesReadiness(
  input: TaskInput[], directory: string
): Promise<ReadinessReport> {
  const tasks = validateTasks(input);
  const approvals = await approvalStatus(tasks, directory);
  const lookup = new Map(approvals.tasks.map(task => [task.id, task]));
  const results: ReadinessTask[] = tasks.map(task => {
    const own = lookup.get(task.id)!;
    const reasons: string[] = [];
    if (own.planningStatus !== "completed") reasons.push("PLANNING_NOT_COMPLETED");
    if (own.approval !== "approved") {
      reasons.push(own.approval === "rejected" ? "APPROVAL_REJECTED" :
        own.approval === "pending" ? "APPROVAL_PENDING" : "APPROVAL_BLOCKED");
    }
    for (const dep of task.dependsOn) {
      const dependency = lookup.get(dep)!;
      if (dependency.planningStatus !== "completed" || dependency.approval !== "approved")
        reasons.push("DEPENDENCY_NOT_APPROVED:" + dep);
    }
    return {
      id: task.id,
      status: reasons.length ? "blocked" : "ready_for_isolated_preparation",
      reasons,
      dependencies: [...task.dependsOn],
      planningStatus: own.planningStatus,
      approval: own.approval
    };
  });
  const ready = results.filter(result => result.status === "ready_for_isolated_preparation").length;
  return {
    mode: "readiness-only", codeExecutionAuthorized: false, publishingAuthorized: false,
    total: results.length, ready, blocked: results.length - ready, tasks: results
  };
}
