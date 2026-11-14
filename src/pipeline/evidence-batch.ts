import { createHash } from "node:crypto";
import { analyzeLegacyEvidence } from "../analysis/legacy-evidence.js";
import { runBoundedQueue, type QueueOptions, type QueueOutcome } from "../autopilot/bounded-queue.js";
import { runCheckpointed, type Checkpoint, type CheckpointStore, type PipelineStep } from "../autopilot/checkpoint-runner.js";
import { runSyntheticPipeline } from "./synthetic-pipeline.js";
import type { EvidenceGatedInput } from "./evidence-gated-pipeline.js";

export interface EvidenceBatchJob { id: string; input: EvidenceGatedInput }
const jobId = (id: string) => createHash("sha256").update("evidence-v1:" + id).digest("hex").slice(0, 20);
const steps: readonly PipelineStep[] = [
  { id: "evidence", run: async raw => {
    const input = raw as EvidenceGatedInput;
    if (input.evidence.pageId !== input.pageId) throw new Error("Evidence mismatch");
    return analyzeLegacyEvidence(input.evidence);
  } },
  { id: "composition", run: async raw => runSyntheticPipeline(raw as EvidenceGatedInput) },
  { id: "quality-gate", run: async (_raw, previous) => {
    const evidence = previous.evidence as ReturnType<typeof analyzeLegacyEvidence>;
    const migration = previous.composition as ReturnType<typeof runSyntheticPipeline>;
    return {
      status: !evidence.readyForReview || migration.status === "blocked" ? "blocked" : "review-required",
      requiresHumanReview: true,
      publishable: false,
      aemWritePerformed: false,
    };
  } },
];
/** Checkpointed offline evidence batch; no browser access or external writes. */
export async function runEvidenceBatch(
  jobs: readonly EvidenceBatchJob[],
  store: CheckpointStore,
  options: QueueOptions,
  onProgress?: (id: string, stage: string, completed: number, total: number) => void,
): Promise<QueueOutcome<Checkpoint>[]> {
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!job || !/^[A-Za-z0-9_-]{1,80}$/.test(job.id) || seen.has(job.id) ||
        job.input?.pageId !== job.input?.evidence?.pageId) throw new Error("Invalid evidence batch job");
    seen.add(job.id);
  }
  return runBoundedQueue(jobs.map(job => async signal => {
    if (signal.aborted) throw new Error("Cancelled");
    return runCheckpointed(jobId(job.id), job.input, steps.map(step => ({
      ...step,
      run: async (input, previous) => {
        if (signal.aborted) throw new Error("Cancelled");
        return step.run(input, previous);
      },
    })), store, (stage, completed, total) => onProgress?.(job.id, stage, completed, total));
  }), options);
}
