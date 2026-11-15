import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { decideApproval } from "../src/integrations/hermes-approval-gate.js";
import { evaluateHermesReadiness } from "../src/integrations/hermes-readiness-gate.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("readiness blocks unapproved tasks and their dependents without authorizing execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-readiness-"));
  const tasks = [
    { id: "home", route: "/home", components: ["hero"], dependsOn: [] },
    { id: "products", route: "/products", components: ["cards"], dependsOn: ["home"] }
  ];
  const runner = async (pages: PageInput[], checkpointDirectory: string): Promise<ResumeResult> => ({
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: 1, planned: 1, reviewRequired: 0, reused: 0, executed: 1,
    checkpointDirectory, results: [{ id: pages[0].id, status: "planned", reason: "VALID" }]
  });
  try {
    await orchestrateHermesTasks(tasks, dir, runner);
    const initial = await evaluateHermesReadiness(tasks, dir);
    assert.equal(initial.blocked, 2);
    assert.equal(initial.codeExecutionAuthorized, false);
    await decideApproval(tasks, dir, "products", "approved", "reviewer");
    const dependent = await evaluateHermesReadiness(tasks, dir);
    assert.ok(dependent.tasks[1].reasons.includes("DEPENDENCY_NOT_APPROVED:home"));
    await decideApproval(tasks, dir, "home", "approved", "reviewer");
    const ready = await evaluateHermesReadiness(tasks, dir);
    assert.equal(ready.ready, 2);
    assert.equal(ready.codeExecutionAuthorized, false);
    assert.equal(ready.publishingAuthorized, false);
    await decideApproval(tasks, dir, "home", "rejected", "reviewer");
    const rejected = await evaluateHermesReadiness(tasks, dir);
    assert.equal(rejected.blocked, 2);
    assert.ok(rejected.tasks[0].reasons.includes("APPROVAL_REJECTED"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
