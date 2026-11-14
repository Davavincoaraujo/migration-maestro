import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createReadDispatcher } from "../mcp/dispatcher.js";
import { runEvidenceBatch, type EvidenceBatchJob } from "../pipeline/evidence-batch.js";
import { FileCheckpointStore } from "../autopilot/file-checkpoint-store.js";
import type { Checkpoint } from "../autopilot/checkpoint-runner.js";
import type { QueueOptions, QueueOutcome } from "../autopilot/bounded-queue.js";

export interface WorkbenchJob {
  id: string;
  status: "blocked" | "review-required" | "failed" | "cancelled";
  stages: string[];
  findings: string[];
  componentCount: number;
  requiresHumanReview: true;
  aemWritePerformed: false;
  reviewDecision: "pending" | "approved" | "rejected";
}
export interface WorkbenchReport {
  schemaVersion: 1;
  generatedAt: string;
  jobs: WorkbenchJob[];
  summary: { total: number; blocked: number; reviewRequired: number; failed: number; cancelled: number };
  metrics: { completedStages: number; stageExecutions: number; reusedCheckpoints: number; elapsedMs: number; estimatedModelCostBRL: 0 };
  noAemWrites: true;
}
function summarize(id: string, outcome: QueueOutcome<Checkpoint>): WorkbenchJob {
  const common = { id, requiresHumanReview: true as const, aemWritePerformed: false as const, reviewDecision: "pending" as const };
  if (outcome.status !== "fulfilled") return {
    ...common, status: outcome.status === "cancelled" ? "cancelled" as const : "failed" as const,
    stages: [], findings: [], componentCount: 0,
  };
  const checkpoint = outcome.value;
  const gate = checkpoint.outputs["quality-gate"] as { status?: string } | undefined;
  const evidence = checkpoint.outputs.evidence as { findings?: { code: string }[] } | undefined;
  const composition = checkpoint.outputs.composition as { plan?: { components?: unknown[]; findings?: { code: string }[] } } | undefined;
  return {
    ...common,
    status: gate?.status === "review-required" ? "review-required" : "blocked",
    stages: [...checkpoint.completed],
    findings: [...(evidence?.findings ?? []), ...(composition?.plan?.findings ?? [])].map(f => f.code),
    componentCount: composition?.plan?.components?.length ?? 0,
  };
}
/** Local synthetic workbench. No external writes, model calls or approval actions. */
export async function runLocalWorkbench(
  jobs: readonly EvidenceBatchJob[], checkpointDirectory: string, options: QueueOptions,
  onProgress?: (id: string, stage: string, completed: number, total: number) => void,
): Promise<WorkbenchReport> {
  const store = new FileCheckpointStore(checkpointDirectory);
  const before = await Promise.all(jobs.map(async j => {
    const id = createHash("sha256").update("evidence-v1:" + j.id).digest("hex").slice(0, 20);
    return store.get(id);
  }));
  const started = performance.now();
  const outcomes = await runEvidenceBatch(jobs, store, options, onProgress);
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const records = outcomes.map((outcome, i) => summarize(jobs[i].id, outcome));
  const reusedCheckpoints = before.filter(c => c?.state === "awaiting-review").length;
  const completedStages = records.reduce((sum, j) => sum + j.stages.length, 0);
  const stageExecutions = outcomes.reduce((sum, result, i) => sum + (result.status === "fulfilled" ? Math.max(0, result.value.completed.length - (before[i]?.completed.length ?? 0)) : 0), 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    jobs: records,
    summary: {
      total: records.length,
      blocked: records.filter(j => j.status === "blocked").length,
      reviewRequired: records.filter(j => j.status === "review-required").length,
      failed: records.filter(j => j.status === "failed").length,
      cancelled: records.filter(j => j.status === "cancelled").length,
    },
    metrics: {
      completedStages,
      stageExecutions,
      reusedCheckpoints,
      elapsedMs,
      estimatedModelCostBRL: 0,
    },
    noAemWrites: true,
  };
}
export function createWorkbenchReadTools(report: WorkbenchReport) {
  return createReadDispatcher({
    "source.list": async () => report.jobs.map(j => ({ id: j.id, status: j.status })),
    "source.read": async args => {
      if (typeof args.id !== "string") throw new Error("Invalid job");
      return report.jobs.find(j => j.id === args.id) ?? null;
    },
    "target.preview": async args => {
      if (typeof args.id !== "string") throw new Error("Invalid job");
      const job = report.jobs.find(j => j.id === args.id);
      return job ? { id: job.id, status: job.status, components: job.componentCount, publishable: false } : null;
    },
    "job.status": async args => {
      if (typeof args.id !== "string") throw new Error("Invalid job");
      const job = report.jobs.find(j => j.id === args.id);
      return job ? { id: job.id, status: job.status, stages: job.stages } : null;
    },
  });
}
