import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHistoryStore } from "../src/workbench/agent-history.js";
import { summarizeAgentHistory } from "../src/workbench/observability-summary.js";

test("observability metrics aggregate completed, reused, failures and durations", () => {
  const entries = [
    { sequence: 1, timestamp: "2026-11-14T00:00:00Z", jobId: "demo", kind: "run.started" as const },
    { sequence: 2, timestamp: "2026-11-14T00:00:01Z", jobId: "demo", kind: "agent.completed" as const, agentId: "mapping", elapsedMs: 10 },
    { sequence: 3, timestamp: "2026-11-14T00:00:02Z", jobId: "demo", kind: "agent.reused" as const, agentId: "mapping", elapsedMs: 20 },
    { sequence: 4, timestamp: "2026-11-14T00:00:03Z", jobId: "demo", kind: "run.failed" as const, elapsedMs: 30 },
  ];
  const summary = summarizeAgentHistory(entries);
  assert.equal(summary.runsFailed, 1);
  assert.equal(summary.reusedEvents, 1);
  assert.equal(summary.agents.find(a => a.id === "mapping")?.averageElapsedMs, 15);
  assert.equal(summary.jobs[0]?.completedAgents, 1);
});

test("observability summary reads persisted metadata without payloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-observe-"));
  try {
    const store = new AgentHistoryStore(dir);
    await store.append({ jobId: "demo", kind: "run.started" });
    await store.append({ jobId: "demo", kind: "agent.completed", agentId: "discovery", elapsedMs: 7 });
    await store.append({ jobId: "other", kind: "run.failed", elapsedMs: 11 });
    const summary = summarizeAgentHistory(await new AgentHistoryStore(dir).list());
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.runsFailed, 1);
    assert.equal(summary.agents.find(agent => agent.id === "discovery")?.completed, 1);
    assert.equal(summary.jobs.find(job => job.id === "demo")?.completedAgents, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
