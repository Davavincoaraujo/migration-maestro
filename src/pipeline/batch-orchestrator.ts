import { createHash } from "node:crypto";
import { runBoundedQueue, type QueueOptions, type QueueOutcome } from "../autopilot/bounded-queue.js";
import { runCheckpointed, type Checkpoint, type CheckpointStore, type PipelineStep } from "../autopilot/checkpoint-runner.js";
import { planLegacyMappings } from "../planning/legacy-mapping.js";
import { composePage } from "../planning/page-composition.js";
import { simulateUePattern } from "../mcp/ue-pattern-simulator.js";
import { buildJiraHandoff } from "../reporting/jira-handoff.js";
import type { SyntheticPipelineInput } from "./synthetic-pipeline.js";

export interface BatchJob { id: string; input: SyntheticPipelineInput; }
const safeId = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 20);
function stages(): PipelineStep[] {
  return [
    { id: "map", run: async (raw) => {
      const input = raw as SyntheticPipelineInput;
      return planLegacyMappings(input.sections, input.catalog, 20);
    } },
    { id: "compose", run: async (raw, previous) => {
      const input = raw as SyntheticPipelineInput;
      return composePage(input.pageId, previous.map as ReturnType<typeof planLegacyMappings>, input.catalog);
    } },
    { id: "simulate", run: async (_raw, previous) =>
      simulateUePattern(previous.compose as ReturnType<typeof composePage>) },
    { id: "handoff", run: async (_raw, previous) =>
      buildJiraHandoff(previous.compose as ReturnType<typeof composePage>) },
  ];
}
/**
 * Synthetic-only orchestration. The supplied store must support isolated
 * job IDs and concurrent puts. It does not provide distributed leases.
 */
export async function runSyntheticBatch(
  jobs: readonly BatchJob[],
  store: CheckpointStore,
  options: QueueOptions,
): Promise<QueueOutcome<Checkpoint>[]> {
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!job || !/^[A-Za-z0-9_-]{1,80}$/.test(job.id) || seen.has(job.id)) throw new Error("Invalid or duplicate batch job");
    seen.add(job.id);
  }
  return runBoundedQueue(jobs.map(job => async (signal) => {
    if (signal.aborted) throw new Error("Cancelled");
    return runCheckpointed(safeId(job.id), job.input, stages().map(step => ({
      ...step,
      run: async (input, previous) => {
        if (signal.aborted) throw new Error("Cancelled");
        return step.run(input, previous);
      },
    })), store);
  }), options);
}
