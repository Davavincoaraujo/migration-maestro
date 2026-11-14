import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/workbench/review-server.js";
import type { WorkbenchReport } from "../src/workbench/local-workbench.js";
const report: WorkbenchReport = {
  schemaVersion: 1, generatedAt: "2026-01-01T00:00:00Z",
  jobs: [{ id: "demo", status: "review-required", stages: ["evidence", "quality-gate"], findings: [], componentCount: 1, requiresHumanReview: true, aemWritePerformed: false, reviewDecision: "pending" },
    { id: "blocked", status: "blocked", stages: [], findings: ["broken-links"], componentCount: 0, requiresHumanReview: true, aemWritePerformed: false, reviewDecision: "pending" }],
  summary: { total: 2, blocked: 1, reviewRequired: 1, failed: 0, cancelled: 0 },
  metrics: { completedStages: 2, stageExecutions: 2, reusedCheckpoints: 0, elapsedMs: 1, estimatedModelCostBRL: 0 },
  noAemWrites: true,
};
test("dashboard requires CSRF and origin, persists approval, and refuses replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-ui-"));
  await writeFile(join(dir, "report.json"), JSON.stringify(report));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = "http://127.0.0.1:" + address.port;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Aprovar plano/);
    assert.doesNotMatch(html, /name="jobId" value="blocked"/);
    const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    const digest = html.match(/name="digest" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf && digest);
    const body = new URLSearchParams({ csrf, jobId: "demo", reviewer: "reviewer_1", decision: "approved", digest });
    const denied = await fetch(base + "/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
    assert.equal(denied.status, 403);
    const headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Origin: base };
    const wrongOrigin = await fetch(base + "/review", { method: "POST", headers: { ...headers, Origin: "http://evil.example", "Sec-Fetch-Site": "same-origin" }, body, redirect: "manual" });
    assert.equal(wrongOrigin.status, 403);
    const crossSite = await fetch(base + "/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "cross-site" }, body, redirect: "manual" });
    assert.equal(crossSite.status, 403);
    const noOrigin = await fetch(base + "/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "manual" });
    assert.equal(noOrigin.status, 303);
    const nullOriginReplay = await fetch(base + "/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "null" }, body, redirect: "manual" });
    assert.equal(nullOriginReplay.status, 400);
    const accepted = await fetch(base + "/review", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Sec-Fetch-Site": "same-origin" }, body, redirect: "manual" });
    assert.equal(accepted.status, 400);
    const saved = JSON.parse(await readFile(join(dir, "reviews.json"), "utf8")) as { entries: { decision: string }[] };
    assert.equal(saved.entries[0].decision, "approved");
    const repeated = await fetch(base + "/review", { method: "POST", headers, body, redirect: "manual" });
    assert.equal(repeated.status, 400);
    assert.match(await (await fetch(base)).text(), /approved by reviewer_1/);
  } finally { await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done())); await rm(dir, { recursive: true, force: true }); }
});
