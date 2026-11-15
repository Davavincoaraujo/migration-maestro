import type { WorkflowDefinition } from "../contracts/index.js";
const idPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;
export function validateWorkflow(value: WorkflowDefinition): WorkflowDefinition {
  if (!value || !idPattern.test(value.id) || !Number.isSafeInteger(value.version) || value.version < 1 ||
      !Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > 100) throw new Error("INVALID_WORKFLOW");
  const ids = new Set<string>();
  for (const task of value.tasks) {
    if (!task || !idPattern.test(task.id) || typeof task.label !== "string" || !task.label.trim() ||
        task.label.length > 200 || !idPattern.test(task.capability) || !Array.isArray(task.dependsOn) ||
        !Array.isArray(task.toolIds) || task.dependsOn.length > 100 || task.toolIds.length > 100 ||
        typeof task.requiresApproval !== "boolean" || ids.has(task.id) ||
        !task.dependsOn.every(id => typeof id === "string" && idPattern.test(id)) ||
        !task.toolIds.every(id => typeof id === "string" && idPattern.test(id))) throw new Error("INVALID_TASK");
    ids.add(task.id);
  }
  const byId = new Map(value.tasks.map(t => [t.id, t]));
  const colors = new Map<string, number>();
  function visit(id: string): void {
    if (!byId.has(id)) throw new Error("UNKNOWN_DEPENDENCY");
    if (colors.get(id) === 1) throw new Error("CYCLIC_WORKFLOW");
    if (colors.get(id) === 2) return;
    colors.set(id, 1);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    colors.set(id, 2);
  }
  for (const id of ids) visit(id);
  return value;
}
