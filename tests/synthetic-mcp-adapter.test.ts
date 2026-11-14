import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticMcpAdapter, createSyntheticReportConnector } from "../src/integrations/synthetic-mcp-adapter.js";
import { ConnectorRegistry } from "../src/integrations/connector-contract.js";
import type { WorkbenchReport } from "../src/workbench/local-workbench.js";

const report: WorkbenchReport = {
  schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z",
  jobs: [{
    id: "demo", status: "review-required", stages: ["evidence", "composition", "quality-gate"],
    findings: [], componentCount: 3, requiresHumanReview: true, aemWritePerformed: false, reviewDecision: "pending",
  }],
  summary: { total: 1, blocked: 0, reviewRequired: 1, failed: 0, cancelled: 0 },
  metrics: { completedStages: 3, stageExecutions: 3, reusedCheckpoints: 0, elapsedMs: 1, estimatedModelCostBRL: 0 },
  noAemWrites: true,
};

test("synthetic adapter exposes read-only MCP-shaped tools", async () => {
  const invoke = createSyntheticMcpAdapter(report);
  const list = await invoke({ tool: "source.list", args: {} });
  assert.equal(list.ok, true);
  assert.deepEqual(list.data, [{ id: "demo", status: "review-required" }]);
  const read = await invoke({ tool: "source.read", args: { id: "demo" } });
  assert.deepEqual(read.data, { id: "demo", componentCount: 3, synthetic: true });
  const preview = await invoke({ tool: "target.preview", args: { id: "demo" } });
  assert.deepEqual(preview.data, { id: "demo", status: "review-required", componentCount: 3, publishable: false });
  const status = await invoke({ tool: "job.status", args: { id: "demo" } });
  assert.deepEqual(status.data, { id: "demo", status: "review-required", stages: ["evidence", "composition", "quality-gate"] });
});

test("synthetic adapter rejects writes and unknown jobs without leaking content", async () => {
  const invoke = createSyntheticMcpAdapter(report);
  assert.deepEqual(await invoke({ tool: "source.write", args: { id: "demo" } }), { ok: false, error: "tool-not-allowed" });
  assert.deepEqual(await invoke({ tool: "source.read", args: { id: "unknown" } }), { ok: false, error: "tool-execution-failed" });
  assert.deepEqual(await invoke({ tool: "source.read", args: {} }), { ok: false, error: "tool-execution-failed" });
  const registry = new ConnectorRegistry();
  registry.register(createSyntheticReportConnector(report));
  await assert.rejects(registry.invoke("synthetic-report", { capability: "job.status", jobId: "unknown" }));
});
