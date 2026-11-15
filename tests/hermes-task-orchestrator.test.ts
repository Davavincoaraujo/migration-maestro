import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateTasks, orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import type { resumeHermesBatch } from "../src/integrations/hermes-checkpoint-runner.js";

test("rejects cycles and unknown dependencies", () => {
  assert.throws(() => validateTasks([{ id: "a", route: "/a", components: [], dependsOn: ["missing"] }]));
  assert.throws(() => validateTasks([
    { id: "a", route: "/a", components: [], dependsOn: ["b"] },
    { id: "b", route: "/b", components: [], dependsOn: ["a"] }
  ]));
});
test("orders dependent tasks and keeps execution disabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-task-test-"));
  const seen: string[] = [];
  const runner = (async (pages: { id: string }[]) => {
    seen.push(pages[0].id);
    return { reused: 0, executed: 1, results: [{ id: pages[0].id, status: "planned", reason: "VALID" }] };
  }) as typeof resumeHermesBatch;
  try {
    const result = await orchestrateHermesTasks([
      { id: "b", route: "/b", components: [], dependsOn: ["a"] },
      { id: "a", route: "/a", components: [], dependsOn: [] }
    ], dir, runner);
    assert.deepEqual(seen, ["a", "b"]);
    assert.equal(result.codeExecutionAuthorized, false);
    assert.ok(result.tasks.every(t => t.status === "completed"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
