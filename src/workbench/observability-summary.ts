import type { AgentHistoryEntry } from "./agent-history.js";
import { defaultMigrationAgents } from "../orchestration/agent-graph.js";

export interface AgentMetric {
  id: string; completed: number; reused: number; measuredEvents: number;
  totalElapsedMs: number; averageElapsedMs: number | null;
}
export interface JobMetric {
  id: string; runsStarted: number; runsCompleted: number; runsFailed: number;
  completedAgents: number; reusedEvents: number; latestEvent: string;
}
export interface ObservabilitySummary {
  totalEvents: number; runsStarted: number; runsCompleted: number;
  runsFailed: number; reusedEvents: number; agents: AgentMetric[]; jobs: JobMetric[];
}

/** Aggregates bounded persisted metadata only; no handler inputs or outputs. */
export function summarizeAgentHistory(entries: readonly AgentHistoryEntry[]): ObservabilitySummary {
  const agents = defaultMigrationAgents.filter(n => n.execution !== "human-gate").map(n => {
    const events = entries.filter(e => e.agentId === n.id);
    const durations = events.filter(e => (e.kind === "agent.completed" || e.kind === "agent.reused") && e.elapsedMs !== undefined);
    const totalElapsedMs = durations.reduce((sum, e) => sum + (e.elapsedMs ?? 0), 0);
    return { id: n.id, completed: events.filter(e => e.kind === "agent.completed").length,
      reused: events.filter(e => e.kind === "agent.reused").length, measuredEvents: durations.length,
      totalElapsedMs, averageElapsedMs: durations.length ? Math.round(totalElapsedMs / durations.length) : null };
  });
  const jobs = new Map<string, JobMetric>();
  for (const e of entries) {
    const job = jobs.get(e.jobId) ?? { id: e.jobId, runsStarted: 0, runsCompleted: 0,
      runsFailed: 0, completedAgents: 0, reusedEvents: 0, latestEvent: e.timestamp };
    if (e.kind === "run.started") job.runsStarted++;
    if (e.kind === "run.completed") job.runsCompleted++;
    if (e.kind === "run.failed") job.runsFailed++;
    if (e.kind === "agent.completed") job.completedAgents++;
    if (e.kind === "agent.reused") job.reusedEvents++;
    job.latestEvent = e.timestamp;
    jobs.set(e.jobId, job);
  }
  return { totalEvents: entries.length,
    runsStarted: entries.filter(e => e.kind === "run.started").length,
    runsCompleted: entries.filter(e => e.kind === "run.completed").length,
    runsFailed: entries.filter(e => e.kind === "run.failed").length,
    reusedEvents: entries.filter(e => e.kind === "agent.reused").length,
    agents, jobs: [...jobs.values()].reverse() };
}
