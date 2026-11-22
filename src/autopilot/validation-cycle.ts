import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "../integrations/aem-create-only.js";
import { classifyExecutionFailure, type FailureKind } from "../ai/model-router.js";

export interface TrustedCheck { id: string; command: string; args: string[]; timeoutMs: number; }
export interface ValidationPolicy { checks: TrustedCheck[]; maxRepairs: number; maxDurationMs: number; }
export interface CheckOutcome { id: string; status: "passed" | "failed"; exitCode: number | null; failureKind: FailureKind | null; logFile: string; logDigest: string; durationMs: number; }
export interface RepairContext { attempt: number; failed: CheckOutcome[]; directory: string; remainingMs: number; }
interface CycleState { version: 1; policyDigest: string; startedAt: number; repairs: number; phase: "testing" | "repair-intent" | "repaired" | "passed" | "blocked"; checks: CheckOutcome[]; }
async function atomic(path: string, value: unknown) {
  const temp = path + "." + randomUUID();
  try { await writeFile(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
/** Commands come from coordinator/operator policy, NEVER from generated source or agent output.
 * Each repair has durable intent. Recovery must explicitly reconcile the same attempt.
 */
export async function runValidationCycle(options: {
  directory: string; project: string; policy: ValidationPolicy; commandEnvironment?: Record<string, string>;
  repair?: (context: RepairContext) => Promise<void>;
  reconcileRepair?: (context: RepairContext) => Promise<void>;
}) {
  const { policy, directory } = options;
  if (!Number.isInteger(policy.maxRepairs) || policy.maxRepairs < 0 || policy.maxRepairs > 3 || !Number.isInteger(policy.maxDurationMs) || policy.maxDurationMs < 100 || policy.maxDurationMs > 3_600_000 ||
      !Array.isArray(policy.checks) || !policy.checks.length || policy.checks.length > 20 || new Set(policy.checks.map(c => c.id)).size !== policy.checks.length ||
      policy.checks.some(c => !/^[a-z][a-z0-9-]{0,63}$/.test(c.id) || !c.command || !Array.isArray(c.args) || c.args.some(a => typeof a !== "string") || !Number.isInteger(c.timeoutMs) || c.timeoutMs < 100 || c.timeoutMs > 600_000)) throw Error("INVALID_VALIDATION_POLICY");
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, "cycle.lock");
  const lock = await open(lockPath, "wx").catch(() => { throw Error("VALIDATION_CYCLE_LOCKED_REQUIRES_RECONCILIATION"); });
  const stateFile = join(directory, "state.json");
  const policyDigest = sha256(JSON.stringify({ project: options.project, policy, ...(options.commandEnvironment ? { commandEnvironment: options.commandEnvironment } : {}) }));
  let state: CycleState = { version: 1, policyDigest, startedAt: Date.now(), repairs: 0, phase: "testing", checks: [] };
  const remaining = () => Math.max(0, policy.maxDurationMs - (Date.now() - state.startedAt));
  const context = (): RepairContext => ({ attempt: state.repairs, failed: state.checks.filter(c => c.status === "failed"), directory, remainingMs: remaining() });
  try {
    try { state = JSON.parse(await readFile(stateFile, "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (state.version !== 1 || state.policyDigest !== policyDigest || !Number.isInteger(state.repairs) || state.repairs < 0 || state.repairs > policy.maxRepairs || !Number.isFinite(state.startedAt) || !["testing", "repair-intent", "repaired", "passed", "blocked"].includes(state.phase) || !Array.isArray(state.checks)) throw Error("VALIDATION_STATE_MISMATCH");
    if (state.phase === "blocked") throw Error("VALIDATION_CIRCUIT_OPEN");
    // A completed cycle is re-tested on resume: previous green logs are never current proof.
    if (state.phase === "repair-intent") {
      if (!options.reconcileRepair) throw Error("REPAIR_RECONCILIATION_REQUIRED");
      if (!remaining()) throw Error("VALIDATION_TIME_BUDGET_EXHAUSTED");
      await options.reconcileRepair(context()); state.phase = "repaired"; await atomic(stateFile, state);
    }
    while (true) {
      if (!remaining()) { state.phase = "blocked"; await atomic(stateFile, state); throw Error("VALIDATION_TIME_BUDGET_EXHAUSTED"); }
      state.phase = "testing"; state.checks = []; await atomic(stateFile, state);
      for (const check of policy.checks) {
        if (!remaining()) { state.phase = "blocked"; await atomic(stateFile, state); throw Error("VALIDATION_TIME_BUDGET_EXHAUSTED"); }
        const started = Date.now(); let output = "", exitCode: number | null = 0;
        const commandEnv: NodeJS.ProcessEnv = { ...process.env, ...options.commandEnvironment, CI: "true" };
        delete commandEnv.NODE_TEST_CONTEXT;
        try {
          const result = await promisify(execFile)(check.command, check.args, { cwd: options.project, timeout: Math.min(check.timeoutMs, remaining()), maxBuffer: 512_000, env: commandEnv });
          output = result.stdout + result.stderr;
        } catch (error) {
          const e = error as { stdout?: string; stderr?: string; code?: unknown; killed?: boolean };
          output = (e.stdout ?? "") + (e.stderr ?? "");
          exitCode = typeof e.code === "number" ? e.code : null;
          if (e.killed) output += "\nCOMMAND_TIMEOUT";
          else if (exitCode === null) output += "\nCOMMAND_INFRASTRUCTURE_FAILURE";
        }
        const logFile = `cycle-${state.repairs}-${check.id}-${randomUUID()}.log`;
        await writeFile(join(directory, logFile), output, { flag: "wx", mode: 0o600 });
        const classified = classifyExecutionFailure(output);
        const failureKind = exitCode === null ? "infrastructure" : classified === "unknown" ? "quality" : classified;
        state.checks.push({ id: check.id, status: exitCode === 0 ? "passed" : "failed", exitCode, failureKind: exitCode === 0 ? null : failureKind, logFile, logDigest: sha256(output), durationMs: Date.now() - started });
        await atomic(stateFile, state);
      }
      await atomic(join(directory, `report-${state.repairs}-${randomUUID()}.json`), state);
      if (state.checks.every(c => c.status === "passed")) {
        state.phase = "passed"; await atomic(stateFile, state);
        return { version: 1, status: "passed" as const, repairs: state.repairs, checks: state.checks, policyDigest, usage: null, validatedAt: new Date().toISOString() };
      }
      if (state.repairs >= policy.maxRepairs || !options.repair || state.checks.some(c => ["authorization", "infrastructure", "rate_limit"].includes(c.failureKind ?? ""))) {
        state.phase = "blocked"; await atomic(stateFile, state); throw Error("VALIDATION_FAILED_CIRCUIT_OPEN");
      }
      state.repairs++; state.phase = "repair-intent"; await atomic(stateFile, state);
      await options.repair(context()); state.phase = "repaired"; await atomic(stateFile, state);
    }
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
export function standardPortalValidation(project: string): ValidationPolicy {
  return { maxRepairs: 2, maxDurationMs: 1_800_000, checks: [
    { id: "typecheck", command: process.execPath, args: [join(project, "node_modules/typescript/bin/tsc"), "--noEmit"], timeoutMs: 180_000 },
    ...["lint", "test", "build"].map(id => ({ id, command: "npm", args: ["run", id, ...(id === "test" ? ["--", "--runInBand"] : [])], timeoutMs: 300_000 })),
  ] };
}
