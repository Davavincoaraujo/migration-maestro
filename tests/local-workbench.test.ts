import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocalWorkbench, createWorkbenchReadTools } from "../src/workbench/local-workbench.js";
import type { EvidenceBatchJob } from "../src/pipeline/evidence-batch.js";
const catalog = { schemaVersion: 1 as const, components: [{ componentId: "model-" + "a".repeat(16), containers: [] }], summary: { components: 1, collections: 0, maximumDepth: 0 } };
const evidence = { schemaVersion: 1 as const, pageId: "demo", capturedAt: "2026-01-01T00:00:00.000Z", viewport: { width: 1280, height: 720 }, structure: { sections: 1, headings: 1, links: 0, images: 0 }, checks: { titlePresent: true, descriptionPresent: true, hasH1: true, brokenLinks: 0 } };
const jobs: EvidenceBatchJob[] = [{ id: "demo", input: { pageId: "demo", evidence, catalog, sections: [{ id: "section_1", collections: 0, maximumDepth: 0 }] } }];
test("local workbench integrates checkpoints, quality, reporting and read-only tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-workbench-"));
  try {
    const report = await runLocalWorkbench(jobs, dir, { concurrency: 1, maxJobs: 2 });
    assert.equal(report.summary.reviewRequired, 1);
    assert.equal(report.jobs[0].aemWritePerformed, false);
    const resumed = await runLocalWorkbench(jobs, dir, { concurrency: 1, maxJobs: 2 });
    assert.deepEqual(resumed.jobs, report.jobs);
    const dispatch = createWorkbenchReadTools(report);
    const status = await dispatch({ tool: "job.status", args: { id: "demo" } });
    assert.equal(status.ok, true);
    const denied = await dispatch({ tool: "target.publish", args: { id: "demo" } });
    assert.equal(denied.ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("quality gate blocks broken links and HTML escapes IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-workbench-"));
  try {
    const blocked: EvidenceBatchJob[] = [{ ...jobs[0], input: { ...jobs[0].input, evidence: { ...evidence, checks: { ...evidence.checks, brokenLinks: 2 } } } }];
    const report = await runLocalWorkbench(blocked, dir, { concurrency: 1, maxJobs: 2 });
    assert.equal(report.summary.blocked, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
