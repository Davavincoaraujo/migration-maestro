import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateTasks, orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

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
  const runner = async (pages: PageInput[], checkpointDirectory: string): Promise<ResumeResult> => {
    seen.push(pages[0].id);
    return {
      mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
      total: 1, planned: 1, reviewRequired: 0,
      reused: 0, executed: 1, checkpointDirectory,
      results: [{ id: pages[0].id, status: "planned", reason: "VALID" }]
    };
  };
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
