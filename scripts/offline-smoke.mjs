/**
 * Dependency-free smoke tests for self-contained TypeScript modules.
 * Node >=22.16 required for built-in TypeScript type stripping.
 * No network, CI, credentials, external providers or npm install.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

async function loadLocal(path) {
  const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
  const javascript = stripTypeScriptTypes(source, { mode: "strip" });
  return import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));
}

test("offline model router honors capability and BRL budget", async () => {
  const { routeModel } = await loadLocal("src/ai/model-router.ts");
  const models = [
    { id: "expensive", capabilities: ["vision"], maxInputTokens: 10000, inputPerMillionBRL: 10, outputPerMillionBRL: 20 },
    { id: "economy", capabilities: ["vision"], maxInputTokens: 10000, inputPerMillionBRL: 2, outputPerMillionBRL: 4 },
  ];
  const request = { requiredCapabilities: ["vision"], estimatedInputTokens: 1000, reservedOutputTokens: 1000, maxEstimatedCostBRL: 0.01 };
  assert.equal(routeModel(models, request)?.modelId, "economy");
  assert.equal(routeModel(models, { ...request, requiredCapabilities: ["audio"] }), null);
  assert.equal(routeModel(models, { ...request, maxEstimatedCostBRL: 0 }), null);
});

test("offline queue limits concurrency and handles cancellation", async () => {
  const { runBoundedQueue } = await loadLocal("src/autopilot/bounded-queue.ts");
  let running = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, (_, i) => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 1));
    running--;
    return i;
  });
  const results = await runBoundedQueue(tasks, { concurrency: 2, maxJobs: 6 });
  assert.ok(peak <= 2);
  assert.deepEqual(results.map(r => r.status === "fulfilled" ? r.value : -1), [0, 1, 2, 3, 4, 5]);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await runBoundedQueue(tasks, { concurrency: 2, maxJobs: 6, signal: controller.signal });
  assert.ok(cancelled.every(r => r.status === "cancelled"));
});

test("offline usage accounting enforces budget", async () => {
  const { summarizeUsage, withinBudget } = await loadLocal("src/observability/metrics.ts");
  const rows = summarizeUsage([
    { jobId: "demo", stage: "analyze", durationMs: 20, inputTokens: 1000, outputTokens: 500, calls: 1, errors: 0, reusedEvidence: 0 },
  ], { inputPerMillionBRL: 2, outputPerMillionBRL: 4 });
  assert.equal(rows[0].estimatedCostBRL, 0.004);
  assert.equal(withinBudget(rows[0], { maxCostBRL: 0.005, maxTokens: 1500, maxCalls: 1 }), true);
  assert.equal(withinBudget(rows[0], { maxCostBRL: 0.003, maxTokens: 1500, maxCalls: 1 }), false);
});

test("offline evidence flags broken links", async () => {
  const { analyzeLegacyEvidence } = await loadLocal("src/analysis/legacy-evidence.ts");
  const evidence = {
    schemaVersion: 1, pageId: "demo", capturedAt: "2026-01-01T00:00:00.000Z",
    viewport: { width: 1280, height: 720 },
    structure: { sections: 1, headings: 1, links: 1, images: 0 },
    checks: { titlePresent: true, descriptionPresent: true, hasH1: true, brokenLinks: 1 },
  };
  const result = analyzeLegacyEvidence(evidence);
  assert.equal(result.readyForReview, false);
  assert.equal(result.findings[0].code, "broken-links");
  assert.equal(result.containsScreenshot, false);
});
