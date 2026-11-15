import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { approvalStatus, decideApproval } from "../src/integrations/hermes-approval-gate.js";
import type { resumeHermesBatch, ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("approval gate records decisions but never enables code execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-approval-test-"));
  const tasks = [{ id: "home", route: "/home", components: ["hero"], dependsOn: [] }];
  const runner = async (pages: PageInput[], checkpointDirectory: string): Promise<ResumeResult> => ({
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: 1, planned: 1, reviewRequired: 0, reused: 0, executed: 1,
    checkpointDirectory, results: [{ id: pages[0].id, status: "planned", reason: "VALID" }]
  });
  try {
    await assert.rejects(decideApproval(tasks, dir, "home", "approved", "reviewer"));
    await orchestrateHermesTasks(tasks, dir, runner as typeof resumeHermesBatch);
    assert.equal((await approvalStatus(tasks, dir)).tasks[0].approval, "pending");
    const approved = await decideApproval(tasks, dir, "home", "approved", "reviewer", "checked");
    assert.equal(approved.tasks[0].approval, "approved");
    assert.equal(approved.codeExecutionAuthorized, false);
    const rejected = await decideApproval(tasks, dir, "home", "rejected", "reviewer", "revise");
    assert.equal(rejected.tasks[0].approval, "rejected");
    assert.equal(rejected.audit.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
