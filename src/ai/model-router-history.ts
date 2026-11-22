import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AdaptiveModelCandidate, FailureKind, Provider } from "./model-router.js";

export interface ModelRouteOutcome {
  jobId: string;
  stage: string;
  taskType: string;
  agentId: string;
  provider: Provider;
  modelId: string;
  outcome: "success" | "failed";
  failureKind?: FailureKind;
  attempts: number;
  escalationCount: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  at: string;
}
export interface ModelRouterHistory { version: 1; entries: ModelRouteOutcome[]; }

const idPattern = /^[a-f0-9-]{20,80}$/;
function validate(value: unknown): ModelRouterHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MODEL_HISTORY");
  const history = value as ModelRouterHistory;
  if (history.version !== 1 || !Array.isArray(history.entries) || history.entries.length > 1000) throw new Error("INVALID_MODEL_HISTORY");
  for (const entry of history.entries) {
    if (!entry || !idPattern.test(entry.jobId) || !/^[A-Z_]{2,40}$/.test(entry.stage) || !/^[a-z][a-z0-9-]{0,40}$/.test(entry.taskType) ||
      !/^[a-zA-Z0-9_.-]{1,100}$/.test(entry.agentId) || !["codex", "claude-code", "unknown"].includes(entry.provider) ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(entry.modelId) || !["success", "failed"].includes(entry.outcome) ||
      typeof entry.at !== "string" || !Number.isFinite(Date.parse(entry.at)) || !Number.isInteger(entry.attempts) || entry.attempts < 0 ||
      !Number.isInteger(entry.escalationCount) || entry.escalationCount < 0 || entry.escalationCount > 1) throw new Error("INVALID_MODEL_HISTORY_ENTRY");
    for (const metric of [entry.inputTokens, entry.outputTokens, entry.costUsd, entry.estimatedCostUsd, entry.latencyMs])
      if (metric !== undefined && (!Number.isFinite(metric) || metric < 0)) throw new Error("INVALID_MODEL_HISTORY_METRIC");
  }
  return history;
}

export async function readModelRouterHistory(file: string): Promise<ModelRouterHistory> {
  try { return validate(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

/** Upserts one outcome per logical job/stage so resumed polling does not inflate success rates. */
export async function recordModelRouteOutcome(file: string, value: ModelRouteOutcome): Promise<void> {
  const history = await readModelRouterHistory(file);
  const index = history.entries.findIndex(entry => entry.jobId === value.jobId && entry.stage === value.stage);
  if (index >= 0) history.entries[index] = structuredClone(value);
  else history.entries.push(structuredClone(value));
  if (history.entries.length > 1000) history.entries.splice(0, history.entries.length - 1000);
  const serialized = JSON.stringify(validate(history), null, 2) + "\n";
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = join(dirname(file), ".model-router-history." + randomUUID() + ".tmp");
  try { await writeFile(temp, serialized, { flag: "wx", mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

export function applyModelSuccessHistory(candidates: readonly AdaptiveModelCandidate[], history: ModelRouterHistory): AdaptiveModelCandidate[] {
  return candidates.map(candidate => {
    const entries = history.entries.filter(entry => entry.agentId === candidate.id && entry.provider === candidate.provider && entry.modelId === candidate.modelId &&
      !(entry.outcome === "failed" && ["infrastructure", "rate_limit"].includes(entry.failureKind ?? "")));
    const taskNames = [...new Set(entries.map(entry => entry.taskType))];
    const rates: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const task of taskNames) {
      const relevant = entries.filter(entry => entry.taskType === task);
      rates[task] = relevant.filter(entry => entry.outcome === "success").length / relevant.length;
    }
    return { ...candidate, successRateByTask: rates };
  });
}
