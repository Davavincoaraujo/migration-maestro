import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startReviewServer } from "../src/workbench/review-server.js";
import { renderAgentGraph } from "../src/workbench/agent-graph-html.js";

test("graph visualization includes dependencies and human review", () => {
  const html = renderAgentGraph([{ id: "discovery", status: "completed" }]);
  assert.match(html, /Orquestração de agentes/);
  assert.match(html, /awaiting-review/);
  assert.match(html, /Depende de: discovery/);
  assert.match(html, /completed/);
});

test("dashboard runs isolated local synthetic agent graph and reuses checkpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-agents-"));
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0, resolve("examples/workbench-jobs.json"));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const base = "http://127.0.0.1:" + address.port;
    const page = await (await fetch(base + "/agents")).text();
    assert.match(page, /Executar agentes locais/);
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf);
    const run = (token: string, jobId: string) => fetch(base + "/agents/run", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base },
      body: new URLSearchParams({ csrf: token, jobId }), redirect: "manual",
    });
    assert.equal((await run("bad", "demo")).status, 403);
    assert.equal((await run(csrf, "missing")).status, 400);
    const wait = async () => {
      for (let i = 0; i < 100; i++) {
        const response = await (await fetch(base + "/agents/status")).json() as { status: string; agents: { id: string; status: string }[] };
        if (response.status === "completed") return response;
        if (response.status === "failed") throw new Error("Agent run failed");
        await new Promise<void>(done => setTimeout(done, 10));
      }
      throw new Error("Agent run timeout");
    };
    assert.equal((await run(csrf, "demo")).status, 303);
    const first = await wait();
    assert.equal(first.agents.length, 5);
    assert.equal(first.agents.every(agent => agent.status === "completed"), true);
    assert.match(await (await fetch(base + "/agents")).text(), /Human Review/);
    assert.equal((await run(csrf, "demo")).status, 303);
    const second = await wait();
    assert.equal(second.agents.every(agent => agent.status === "reused"), true);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
