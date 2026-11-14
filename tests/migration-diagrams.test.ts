import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMigrationDiagram, renderDiagramsPage } from "../src/workbench/migration-diagrams.js";
import { startReviewServer } from "../src/workbench/review-server.js";

test("renders three accessible local SVG diagrams with live agent state", () => {
  for (const kind of ["execution", "components", "sequence"] as const) {
    const svg = renderMigrationDiagram(kind, [{ id: "discovery", status: "completed" }]);
    assert.match(svg, /<svg/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title>/);
    assert.doesNotMatch(svg, /<script|onload=/i);
  }
  assert.match(renderMigrationDiagram("execution", [{ id: "discovery", status: "completed" }]), /completed/);
  assert.match(renderMigrationDiagram("execution"), /awaiting-review/);
  assert.match(renderDiagramsPage("sequence", [], "running"), /Estado local: running/);
});

test("dashboard serves diagram tabs locally without accepting unknown kinds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-diagrams-"));
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = "http://127.0.0.1:" + address.port;
    for (const kind of ["execution", "components", "sequence"]) {
      const response = await fetch(base + "/diagrams?kind=" + kind);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<svg/);
    }
    assert.equal((await fetch(base + "/diagrams?kind=invalid")).status, 400);
    assert.equal((await fetch(base + "/diagrams", { method: "POST" })).status, 403);
    assert.match(await (await fetch(base + "/agents")).text(), /Ver diagramas UML/);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("execution SVG links to inline agent inspector and scopes metadata history", () => {
  const svg = renderMigrationDiagram("execution");
  assert.match(svg, /href="\/diagrams\?kind=execution&amp;agent=discovery"/);
  const html = renderDiagramsPage("execution", [{ id: "mapping", status: "completed" }], "completed", "mapping", [
    { sequence: 1, timestamp: "2026-11-14T00:00:00.000Z", jobId: "demo", kind: "agent.completed", agentId: "mapping", elapsedMs: 17 },
    { sequence: 2, timestamp: "2026-11-14T00:00:01.000Z", jobId: "demo", kind: "agent.completed", agentId: "quality", elapsedMs: 99 },
  ], "demo");
  assert.match(html, /Agente selecionado: mapping/);
  assert.match(html, /agent.completed/);
  assert.match(html, /Tempo \(ms\)/);
  assert.doesNotMatch(html, />99<\/td>/);
  assert.doesNotMatch(renderDiagramsPage("components", [], "idle", "mapping"), /Agente selecionado:/);
});

test("diagram agent query is validated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-diagram-agent-"));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = "http://127.0.0.1:" + address.port;
    assert.equal((await fetch(base + "/diagrams?kind=execution&agent=mapping")).status, 200);
    assert.equal((await fetch(base + "/diagrams?kind=execution&agent=invalid")).status, 400);
    assert.match(await (await fetch(base + "/diagrams?kind=execution&agent=mapping")).text(), /Agente selecionado: mapping/);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
