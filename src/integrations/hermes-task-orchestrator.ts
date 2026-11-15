import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resumeHermesBatch } from "./hermes-checkpoint-runner.js";
import { validatePageInputs, type PageInput } from "./hermes-batch-planner.js";

export type TaskInput = PageInput & { dependsOn: string[] };
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "awaiting_approval";
export type TaskState = { id: string; status: TaskStatus; reason: string; dependencies: string[] };
export type Orchestration = {
  mode: "plan-only"; humanApprovalRequired: true; codeExecutionAuthorized: false;
  total: number; tasks: TaskState[]; reused: number; executed: number;
};
type Runner = typeof resumeHermesBatch;
const version = "hermes-orchestrator-v1";

export function validateTasks(input: unknown): TaskInput[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw Error("INVALID_TASKS");
  const pages = validatePageInputs(input.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("INVALID_TASK");
    const obj = item as Record<string, unknown>;
    if (Object.keys(obj).some(k => !["id", "route", "components", "dependsOn"].includes(k))) throw Error("INVALID_TASK");
    return { id: obj.id, route: obj.route, components: obj.components };
  }));
  const ids = new Set(pages.map(p => p.id));
  const tasks = pages.map((page, index) => {
    const obj = input[index] as Record<string, unknown>;
    const deps = obj.dependsOn;
    if (!Array.isArray(deps) || deps.length > 10 ||
      !deps.every((v: unknown) => typeof v === "string" && ids.has(v) && v !== page.id) ||
      new Set(deps).size !== deps.length) throw Error("INVALID_DEPENDENCIES");
    return { ...page, dependsOn: deps as string[] };
  });
  const visiting = new Set<string>(), visited = new Set<string>();
  const lookup = new Map(tasks.map(t => [t.id, t]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw Error("CYCLIC_DEPENDENCIES");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of lookup.get(id)!.dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
  return tasks;
}
function fingerprint(tasks: TaskInput[]): string {
  return createHash("sha256").update(JSON.stringify({ version, tasks })).digest("hex");
}
async function atomicSave(path: string, state: Orchestration): Promise<void> {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

/** Dependencies require validated planning, not execution approval. No code is executed. */
export async function orchestrateHermesTasks(
  input: TaskInput[], directory: string, runner: Runner = resumeHermesBatch
): Promise<Orchestration> {
  const tasks = validateTasks(input);
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const hash = fingerprint(tasks);
  const lockPath = join(root, hash + ".lock");
  const statePath = join(root, hash + ".state.json");
  const lock = await open(lockPath, "wx", 0o600).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "EEXIST") throw Error("ORCHESTRATION_ALREADY_RUNNING");
    throw e;
  });
  const state: Orchestration = {
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: tasks.length, tasks: tasks.map(t => ({
      id: t.id, status: "pending", reason: "NOT_STARTED", dependencies: [...t.dependsOn]
    })), reused: 0, executed: 0
  };
  try {
    // Reconstruct state from validated checkpoints; never trust an old running state.
    await atomicSave(statePath, state);
    const pending = new Set(tasks.map(t => t.id));
    while (pending.size) {
      let progressed = false;
      for (const task of tasks) {
        if (!pending.has(task.id)) continue;
        const dependencies = task.dependsOn.map(id => state.tasks.find(s => s.id === id)!);
        if (dependencies.some(s => s.status === "failed" || s.status === "awaiting_approval")) {
          const current = state.tasks.find(s => s.id === task.id)!;
          current.status = "awaiting_approval";
          current.reason = "DEPENDENCY_REQUIRES_REVIEW";
          pending.delete(task.id);
          await atomicSave(statePath, state);
          progressed = true;
          continue;
        }
        if (dependencies.some(s => s.status !== "completed")) continue;
        const current = state.tasks.find(s => s.id === task.id)!;
        current.status = "running";
        current.reason = "PLANNING";
        await atomicSave(statePath, state);
        try {
          const result = await runner([{ id: task.id, route: task.route, components: task.components }],
            join(root, "page-checkpoints"));
          state.reused += result.reused;
          state.executed += result.executed;
          const outcome = result.results[0];
          current.status = outcome?.status === "planned" ? "completed" : "awaiting_approval";
          current.reason = outcome?.reason ?? "NO_RESULT";
        } catch {
          current.status = "failed";
          current.reason = "PLANNER_FAILED";
        }
        pending.delete(task.id);
        await atomicSave(statePath, state);
        progressed = true;
      }
      if (!progressed) throw Error("UNRESOLVED_DEPENDENCIES");
    }
    return state;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
