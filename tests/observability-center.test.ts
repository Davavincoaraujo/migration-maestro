import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHistoryStore } from "../src/workbench/agent-history.js";
import { renderObservabilityCenter, summarizeAgentHistory } from "../src/workbench/observability-center.js";
import { startReviewServer } from "../src/workbench/review-server.js";

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
  const html = renderObservabilityCenter(entries, "demo");
  assert.match(html, /Observability Center/);
  assert.match(html, /diagrams\?kind=execution&amp;agent=mapping/);
  assert.match(html, /JSON de métricas/);
  assert.doesNotMatch(html, /<script/);
  assert.throws(() => renderObservabilityCenter(entries, "../bad"));
});

test("observability routes read persisted metadata, filter jobs and reject invalid input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-observe-"));
  try {
    const store = new AgentHistoryStore(dir);
    await store.append({ jobId: "demo", kind: "run.started" });
    await store.append({ jobId: "demo", kind: "agent.completed", agentId: "discovery", elapsedMs: 7 });
    await store.append({ jobId: "other", kind: "run.failed", elapsedMs: 11 });
    const server = await startReviewServer(dir, 0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No address");
      const base = "http://127.0.0.1:" + address.port;
      const html = await (await fetch(base + "/observability?job=demo")).text();
      assert.match(html, /Observability Center/);
      assert.match(html, /discovery/);
      const response = await fetch(base + "/observability/data?job=demo");
      assert.equal(response.status, 200);
      const data = await response.json() as { totalEvents: number; runsFailed: number };
      assert.equal(data.totalEvents, 2);
      assert.equal(data.runsFailed, 0);
      assert.equal((await fetch(base + "/observability?job=..%2Fbad")).status, 400);
      assert.equal((await fetch(base + "/observability", { method: "POST" })).status, 403);
      assert.match(await (await fetch(base + "/agents")).text(), /Observability Center/);
    } finally {
      await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
