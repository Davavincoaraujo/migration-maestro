import { createHash } from "node:crypto";
import { runCheckpointed, type CheckpointStore, type PipelineStep } from "../autopilot/checkpoint-runner.js";
import { defaultMigrationAgents, planLocalAgentGraph, type MigrationAgentNode } from "./agent-graph.js";

export type AgentHandler = (input: unknown, dependencies: Readonly<Record<string, unknown>>) => Promise<unknown>;
export type AgentHandlers = Readonly<Record<string, AgentHandler>>;
export interface AgentExecutionEvent {
  agentId: string;
  stage: "completed" | "checkpoint-reused";
  completed: number;
  total: number;
}
export interface AgentExecutionResult {
  jobId: string;
  status: "awaiting-review";
  completedAgents: string[];
  outputs: Readonly<Record<string, unknown>>;
  requiresHumanReview: true;
  aemWritePerformed: false;
}

/**
 * Execute local synthetic agents in dependency order with durable checkpoints.
 * The human review node is never executed automatically.
 */
export async function executeLocalAgentGraph(
  jobId: string,
  input: unknown,
  handlers: AgentHandlers,
  store: CheckpointStore,
  nodes: readonly MigrationAgentNode[] = defaultMigrationAgents,
  onEvent?: (event: AgentExecutionEvent) => void,
): Promise<AgentExecutionResult> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) throw new Error("Invalid job identifier");
  const plan = planLocalAgentGraph(nodes);
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  const executable = plan.executionOrder.filter(id => byId.get(id)?.execution === "synthetic");
  if (Object.keys(handlers).some(id => !executable.includes(id)) ||
      executable.some(id => typeof handlers[id] !== "function")) throw new Error("Agent handler mismatch");
  const steps: PipelineStep[] = executable.map(id => {
    const node = byId.get(id);
    if (!node) throw new Error("Unknown agent");
    return {
      id,
      run: async (raw, previous) => {
        const dependencies = Object.fromEntries(node.dependsOn.map(dep => [dep, previous[dep]]));
        return handlers[id](structuredClone(raw), structuredClone(dependencies));
      },
    };
  });
  const checkpointId = createHash("sha256").update("agent-graph-v1:" + jobId).digest("hex").slice(0, 20);
  // The graph identity is part of the checkpoint input: topology changes invalidate prior results.
  const checkpoint = await runCheckpointed(checkpointId, { input, graph: plan.nodes }, steps.map(step => ({
    id: step.id,
    run: async (raw, previous) => step.run((raw as { input: unknown }).input, previous),
  })), store, (stage, completed, total) => onEvent?.({
    agentId: stage === "checkpoint-reused" ? executable.at(-1) ?? "none" : stage,
    stage: stage === "checkpoint-reused" ? "checkpoint-reused" : "completed",
    completed,
    total,
  }));
  return {
    jobId,
    status: "awaiting-review",
    completedAgents: [...checkpoint.completed],
    outputs: structuredClone(checkpoint.outputs),
    requiresHumanReview: true,
    aemWritePerformed: false,
  };
}

/** Deterministic example handlers, not actual LLM agents or corporate integrations. */
export function createSyntheticAgentHandlers(): AgentHandlers {
  return {
    discovery: async () => ({ discovered: true, synthetic: true }),
    evidence: async (_input, deps) => ({ verified: Boolean(deps.discovery), synthetic: true }),
    mapping: async (_input, deps) => ({ mapped: Boolean(deps.evidence), synthetic: true }),
    composition: async (_input, deps) => ({ proposed: Boolean(deps.mapping), publishable: false }),
    quality: async (_input, deps) => ({ reviewed: Boolean(deps.composition), publishable: false }),
  };
}
