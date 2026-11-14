import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAgentInspector } from "../src/workbench/agent-inspector.js";
import { renderDiagramsPage } from "../src/workbench/migration-diagrams.js";
import { startReviewServer } from "../src/workbench/review-server.js";

test("agent inspector exposes only metadata and navigable dependencies", () => {
  const html = renderAgentInspector("mapping", [{ id: "evidence", status: "completed" }], { status: "running", jobId: "demo" });
  assert.ok(html);
  assert.match(html, /Agente: mapping/);
  assert.match(html, /agents\/inspect\?id=evidence/);
  assert.match(html, /agents\/inspect\?id=composition/);
  assert.match(html, /Job atual/);
  assert.match(html, /Entradas, saídas e checkpoints/);
  assert.equal(renderAgentInspector("unknown", [], { status: "idle" }), null);
  assert.match(renderDiagramsPage("execution", [], "idle"), /agents\/inspect\?id=discovery/);
});

test("agent inspector escapes metadata and rejects unknown agent IDs", async () => {
  const html = renderAgentInspector("discovery", [], { status: "<script>alert(1)</script>", jobId: "<img>" });
  assert.ok(html);
  assert.doesNotMatch(html, /<script>|<img>/);
  const dir = await mkdtemp(join(tmpdir(), "maestro-inspect-"));
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const base = "http://127.0.0.1:" + address.port;
    assert.equal((await fetch(base + "/agents/inspect?id=quality")).status, 200);
    assert.equal((await fetch(base + "/agents/inspect?id=missing")).status, 404);
    assert.equal((await fetch(base + "/agents/inspect?id=quality", { method: "POST" })).status, 403);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent inspector filters history by agent and current job without rendering payloads", () => {
  const entries = [
    { sequence: 1, timestamp: "2026-11-14T00:00:00.000Z", jobId: "demo", kind: "agent.completed" as const, agentId: "mapping", elapsedMs: 12 },
    { sequence: 2, timestamp: "2026-11-14T00:00:01.000Z", jobId: "demo", kind: "agent.completed" as const, agentId: "quality", elapsedMs: 15 },
    { sequence: 3, timestamp: "2026-11-14T00:00:02.000Z", jobId: "other", kind: "agent.reused" as const, agentId: "mapping", elapsedMs: 20 },
  ];
  const html = renderAgentInspector("mapping", [], { status: "completed", jobId: "demo" }, entries);
  assert.ok(html);
  assert.match(html, /Histórico deste agente/);
  assert.match(html, /agent.completed/);
  assert.match(html, /agents\/history\/view\?id=demo/);
  assert.doesNotMatch(html, /agent.reused/);
  assert.doesNotMatch(html, /quality<\/td>/);
  assert.doesNotMatch(html, /2026-11-14T00:00:02/);
});
