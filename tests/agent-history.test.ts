import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHistoryStore } from "../src/workbench/agent-history.js";
import { startReviewServer } from "../src/workbench/review-server.js";

test("durable agent history survives store restart and filters by job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-history-"));
  try {
    const store = new AgentHistoryStore(dir);
    await Promise.all([
      store.append({ jobId: "demo", kind: "run.started" }),
      store.append({ jobId: "demo", kind: "agent.completed", agentId: "discovery", elapsedMs: 12 }),
      store.append({ jobId: "other", kind: "run.failed", elapsedMs: 5 }),
    ]);
    const restored = new AgentHistoryStore(dir);
    const entries = await restored.list("demo");
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map(e => e.sequence), [1, 2]);
    assert.equal((await restored.list()).length, 3);
    await assert.rejects(store.append({ jobId: "../bad", kind: "run.started" }));
    await assert.rejects(store.append({ jobId: "demo", kind: "agent.completed", agentId: "unknown" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("agent runner writes history and read-only endpoint exposes metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-history-server-"));
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0, resolve("examples/workbench-jobs.json"));
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("No server port");
    const base = "http://127.0.0.1:" + addr.port;
    const page = await (await fetch(base + "/agents")).text();
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf);
    const run = await fetch(base + "/agents/run", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
      body: new URLSearchParams({ csrf, jobId: "demo" }), redirect: "manual",
    });
    assert.equal(run.status, 303);
    for (let i = 0; i < 100; i++) {
      const state = await (await fetch(base + "/agents/status")).json() as { status: string };
      if (state.status === "completed") break;
      if (state.status === "failed") throw new Error("Agent run failed");
      await new Promise<void>(done => setTimeout(done, 10));
    }
    const response = await fetch(base + "/agents/history?id=demo");
    assert.equal(response.status, 200);
    const data = await response.json() as { entries: { kind: string; agentId?: string }[] };
    assert.equal(data.entries[0]?.kind, "run.started");
    assert.equal(data.entries.at(-1)?.kind, "run.completed");
    assert.equal(data.entries.filter(e => e.kind === "agent.completed").length, 5);
    assert.equal((await fetch(base + "/agents/history?id=..%2Fsecret")).status, 400);
    assert.equal((await fetch(base + "/agents/history?id=demo", { method: "POST" })).status, 403);
    assert.equal((await new AgentHistoryStore(dir).list("demo")).length, 7);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
