import { createHash } from "node:crypto";
import { FileCheckpointStore } from "../autopilot/file-checkpoint-store.js";
import { createSyntheticAgentHandlers, executeLocalAgentGraph } from "../orchestration/local-agent-executor.js";
import { planAnalyticsHandoff, type AnalyticsHandoff } from "./autopilot-handoff.js";
import { parseSpecification, type Specification } from "./specification.js";

export interface AnalyticsExecutionItem {
  requirementId: string;
  status: "awaiting-human-review";
  completedAgents: string[];
  checkpointReused: boolean;
}
export interface AnalyticsExecutionReport {
  schemaVersion: 1;
  projectId: string;
  specificationDigest: string;
  status: "awaiting-human-review";
  requiresHumanReview: true;
  aemWritePerformed: false;
  allowExternalWrites: false;
  items: AnalyticsExecutionItem[];
}
/**
 * Executes ONLY deterministic synthetic agent handlers for each validated requirement.
 * No code generation, external calls, approval, GitHub mutations or AEM writes.
 */
export async function executeAnalyticsLocally(
  raw: Specification,
  checkpointDirectory: string,
  onProgress?: (requirementId: string, agentId: string, stage: "completed" | "checkpoint-reused") => void,
): Promise<AnalyticsExecutionReport> {
  const spec = parseSpecification(raw);
  const handoff: AnalyticsHandoff = planAnalyticsHandoff(spec);
  const store = new FileCheckpointStore(checkpointDirectory);
  const items: AnalyticsExecutionItem[] = [];
  for (const item of handoff.items) {
    // Include the specification digest so changing any requirement cannot reuse stale checkpoints.
    const id = createHash("sha256").update(handoff.projectId + ":" + handoff.specificationDigest + ":" + item.requirementId)
      .digest("hex").slice(0, 20);
    let checkpointReused = false;
    const result = await executeLocalAgentGraph(id, {
      requirementId: item.requirementId,
      title: item.title,
      description: item.description,
      entityIds: item.entityIds,
      acceptanceCriteria: item.acceptanceCriteria,
      dependsOn: item.dependsOn,
      specificationDigest: handoff.specificationDigest,
    }, createSyntheticAgentHandlers(), store, undefined, event => {
      if (event.stage === "checkpoint-reused") checkpointReused = true;
      onProgress?.(item.requirementId, event.agentId, event.stage);
    });
    items.push({ requirementId: item.requirementId, status: "awaiting-human-review",
      completedAgents: result.completedAgents, checkpointReused });
  }
  return {
    schemaVersion: 1, projectId: handoff.projectId, specificationDigest: handoff.specificationDigest,
    status: "awaiting-human-review", requiresHumanReview: true,
    aemWritePerformed: false, allowExternalWrites: false, items,
  };
}
