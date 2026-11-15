import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateTasks, type TaskInput, type Orchestration } from "./hermes-task-orchestrator.js";

export type Decision = "approved" | "rejected";
export type ApprovalRecord = {
  taskId: string; decision: Decision; reviewer: string; note: string;
  at: string; planDigest: string;
};
export type ApprovalGate = {
  mode: "review-only"; codeExecutionAuthorized: false;
  batchDigest: string; records: ApprovalRecord[];
};
const version = "hermes-orchestrator-v1";
function digest(tasks: TaskInput[]): string {
  return createHash("sha256").update(JSON.stringify({ version, tasks })).digest("hex");
}
function taskDigest(task: TaskInput, state: Orchestration): string {
  const status = state.tasks.find(t => t.id === task.id);
  return createHash("sha256").update(JSON.stringify({ task, status })).digest("hex");
}
async function atomic(path: string, data: ApprovalGate): Promise<void> {
  const tmp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
}
function validRecord(value: unknown): value is ApprovalRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.taskId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(r.taskId) &&
    (r.decision === "approved" || r.decision === "rejected") &&
    typeof r.reviewer === "string" && r.reviewer.length >= 1 && r.reviewer.length <= 80 &&
    typeof r.note === "string" && r.note.length <= 500 &&
    typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) &&
    typeof r.planDigest === "string" && /^[a-f0-9]{64}$/.test(r.planDigest);
}
async function load(path: string, hash: string): Promise<ApprovalGate> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { mode: "review-only", codeExecutionAuthorized: false, batchDigest: hash, records: [] };
    throw e;
  }
  if (raw.length > 131072) throw Error("INVALID_APPROVAL_STORE");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_APPROVAL_STORE");
  const obj = value as Record<string, unknown>;
  if (obj.mode !== "review-only" || obj.codeExecutionAuthorized !== false ||
    obj.batchDigest !== hash || !Array.isArray(obj.records) || !obj.records.every(validRecord))
    throw Error("INVALID_APPROVAL_STORE");
  return { mode: "review-only", codeExecutionAuthorized: false, batchDigest: hash, records: obj.records as ApprovalRecord[] };
}
async function snapshot(tasks: TaskInput[], root: string): Promise<Orchestration> {
  const path = join(root, digest(tasks) + ".state.json");
  const raw = await readFile(path, "utf8");
  if (raw.length > 131072) throw Error("INVALID_ORCHESTRATION_STATE");
  const state: Orchestration = JSON.parse(raw);
  if (state.mode !== "plan-only" || state.codeExecutionAuthorized !== false ||
    state.total !== tasks.length || !Array.isArray(state.tasks) ||
    state.tasks.length !== tasks.length ||
    !tasks.every(t => state.tasks.some(s => s.id === t.id &&
      Array.isArray(s.dependencies) &&
      JSON.stringify(s.dependencies) === JSON.stringify(t.dependsOn) &&
      ["pending", "running", "completed", "failed", "awaiting_approval"].includes(s.status))))
    throw Error("INVALID_ORCHESTRATION_STATE");
  return state;
}
export async function approvalStatus(input: TaskInput[], directory: string) {
  const tasks = validateTasks(input);
  const root = resolve(directory), hash = digest(tasks);
  const state = await snapshot(tasks, root);
  const gate = await load(join(root, hash + ".approvals.json"), hash);
  return {
    mode: "review-only" as const, codeExecutionAuthorized: false as const,
    tasks: tasks.map(t => {
      const plan = state.tasks.find(s => s.id === t.id)!;
      const current = [...gate.records].reverse().find(r =>
        r.taskId === t.id && r.planDigest === taskDigest(t, state));
      return {
        id: t.id, planningStatus: plan.status,
        approval: plan.status !== "completed" ? "blocked" :
          current?.decision ?? "pending",
        reviewer: current?.reviewer ?? null,
        note: current?.note ?? null
      };
    }),
    audit: gate.records
  };
}
/** Local reviewer names are unverified labels, not authenticated identities. */
export async function decideApproval(
  input: TaskInput[], directory: string, taskId: string,
  decision: Decision, reviewer: string, note = ""
) {
  const tasks = validateTasks(input);
  if (!tasks.some(t => t.id === taskId) ||
    !["approved", "rejected"].includes(decision) ||
    !/^[a-zA-Z0-9_.@-]{1,80}$/.test(reviewer) || note.length > 500)
    throw Error("INVALID_APPROVAL_REQUEST");
  const root = resolve(directory), hash = digest(tasks);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Same lock as orchestration: prevent decisions during state changes.
  const lockPath = join(root, hash + ".lock");
  const lock = await open(lockPath, "wx", 0o600).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "EEXIST") throw Error("ORCHESTRATION_BUSY");
    throw e;
  });
  try {
    const state = await snapshot(tasks, root);
    const task = tasks.find(t => t.id === taskId)!;
    if (state.tasks.find(t => t.id === taskId)?.status !== "completed")
      throw Error("TASK_NOT_READY_FOR_APPROVAL");
    const path = join(root, hash + ".approvals.json");
    const gate = await load(path, hash);
    gate.records.push({
      taskId, decision, reviewer, note, at: new Date().toISOString(),
      planDigest: taskDigest(task, state)
    });
    await atomic(path, gate);
    return approvalStatus(tasks, root);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
