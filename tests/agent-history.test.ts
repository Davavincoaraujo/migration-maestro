import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHistoryStore } from "../src/workbench/agent-history.js";

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
