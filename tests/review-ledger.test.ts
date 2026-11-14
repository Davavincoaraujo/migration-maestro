import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordReview, reviewDigest, readReviewLedger } from "../src/workbench/review-ledger.js";
import type { WorkbenchReport } from "../src/workbench/local-workbench.js";
const job = { id: "demo", status: "review-required" as const, stages: ["evidence", "composition", "quality-gate"], findings: [], componentCount: 1, requiresHumanReview: true as const, aemWritePerformed: false as const, reviewDecision: "pending" as const };
const report: WorkbenchReport = { schemaVersion: 1, generatedAt: "2026-01-01T00:00:00Z", jobs: [job], summary: { total: 1, blocked: 0, reviewRequired: 1, failed: 0, cancelled: 0 }, metrics: { completedStages: 3, stageExecutions: 3, reusedCheckpoints: 0, elapsedMs: 1, estimatedModelCostBRL: 0 }, noAemWrites: true };
test("records an explicit digest-bound local decision without publishing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-review-"));
  try {
    const path = join(dir, "reviews.json");
    const digest = reviewDigest(report, "demo");
    const entry = await recordReview(path, report, "demo", "reviewer_1", "approved", digest);
    assert.equal(entry.decision, "approved");
    assert.equal((await readReviewLedger(path)).entries.length, 1);
    await assert.rejects(recordReview(path, report, "demo", "reviewer_1", "rejected", digest), /already recorded/);
    await assert.rejects(recordReview(path, { ...report, jobs: [{ ...job, componentCount: 2 }] }, "demo2", "reviewer_1", "approved", digest), /not eligible/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("blocks stale digests and quality failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-review-"));
  try {
    const path = join(dir, "reviews.json");
    await assert.rejects(recordReview(path, report, "demo", "reviewer_1", "approved", "0".repeat(64)), /digest mismatch/);
    assert.throws(() => reviewDigest({ ...report, jobs: [{ ...job, status: "blocked", findings: ["broken-links"] }] }, "demo"), /not eligible/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
