import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startReviewServer } from "../src/workbench/review-server.js";

test("opt-in dashboard run executes synthetic jobs, reuses checkpoints and rejects invalid CSRF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-run-"));
  const input = resolve("examples/workbench-jobs.json");
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0, input);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const base = "http://127.0.0.1:" + addr.port;
    const page = await (await fetch(base)).text();
    assert.match(page, /Executar lote sintético/);
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf);
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Origin: base };
    const denied = await fetch(base + "/run", { method: "POST", headers, body: new URLSearchParams({ csrf: "bad" }), redirect: "manual" });
    assert.equal(denied.status, 403);
    const run = async () => fetch(base + "/run", { method: "POST", headers, body: new URLSearchParams({ csrf }), redirect: "manual" });
    assert.equal((await run()).status, 303);
    const waitForCompletion = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await fetch(base + "/run-status");
        assert.equal(response.status, 200);
        const state = await response.json() as { status: string };
        if (state.status === "completed") return;
        if (state.status === "failed") throw new Error("Synthetic run failed");
        await new Promise<void>(done => setTimeout(done, 10));
      }
      throw new Error("Timed out waiting for background synthetic run");
    };
    await waitForCompletion();
    const savedReport = await readFile(join(dir, "report.json"), "utf8");
    assert.equal(savedReport.trimEnd().endsWith("}"), true);
    const first = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as { summary: { total: number; blocked: number }; metrics: { stageExecutions: number; reusedCheckpoints: number } };
    assert.equal(first.summary.total, 2);
    assert.equal(first.summary.blocked, 1);
    const eventsResponse = await fetch(base + "/events");
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json() as { events: { sequence: number; type: string }[] };
    assert.equal(events.events[0]?.type, "run.started");
    assert.equal(events.events.at(-1)?.type, "run.completed");
    const last = events.events.at(-1)?.sequence ?? 0;
    const delta = await (await fetch(base + "/events?after=" + last)).json() as { events: unknown[] };
    assert.equal(delta.events.length, 0);
    assert.equal((await fetch(base + "/events?after=-1")).status, 400);
    const progressResponse = await fetch(base + "/run-status");
    const progress = await progressResponse.json() as { jobs: { id: string; status: string; completed: number; total: number }[] };
    assert.equal(progress.jobs.length, 2);
    assert.equal(progress.jobs.find(job => job.id === "demo")?.status, "review-required");
    assert.equal(progress.jobs.find(job => job.id === "blocked")?.status, "blocked");
    assert.equal(progress.jobs.every(job => job.completed === 3 && job.total === 3), true);
    assert.match(await (await fetch(base)).text(), /Progresso dos jobs/);
    assert.equal((await run()).status, 303);
    await waitForCompletion();
    const second = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as typeof first;
    assert.equal(second.metrics.stageExecutions, 0);
    assert.equal(second.metrics.reusedCheckpoints, 2);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
