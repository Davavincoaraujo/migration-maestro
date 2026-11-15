import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { decideApproval } from "../src/integrations/hermes-approval-gate.js";
import { prepareHermesWorkspaces } from "../src/integrations/hermes-workspace-manager.js";
import { preflightHermesBranches } from "../src/integrations/hermes-git-branch-executor.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("branch preflight is read-only and requires an explicitly marked clean demo repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-branch-preflight-"));
  const checkpoints = join(root, "checkpoints"), workspaces = join(root, "workspaces");
  const target = join(root, "demo");
  const tasks = [{ id: "home", route: "/home", components: ["hero"], dependsOn: [] }];
  const runner = async (pages: PageInput[], checkpointDirectory: string): Promise<ResumeResult> => ({
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: 1, planned: 1, reviewRequired: 0, reused: 0, executed: 1,
    checkpointDirectory, results: [{ id: pages[0].id, status: "planned", reason: "VALID" }]
  });
  try {
    await orchestrateHermesTasks(tasks, checkpoints, runner);
    await decideApproval(tasks, checkpoints, "home", "approved", "reviewer");
    await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    await mkdir(target);
    execFileSync("git", ["init", "-q", target]);
    execFileSync("git", ["-C", target, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "init"]);
    await assert.rejects(preflightHermesBranches(tasks, checkpoints, workspaces, target), /DEMO_REPOSITORY_MARKER_REQUIRED/);
    await writeFile(join(target, ".maestro-demo-repo"), "demo\n");
    const result = await preflightHermesBranches(tasks, checkpoints, workspaces, target);
    assert.equal(result.ready, 1);
    assert.equal(result.gitOperationsPerformed, false);
    assert.equal(result.tasks[0].status, "ready");
    await writeFile(join(target, "untracked.txt"), "changed");
    const dirty = await preflightHermesBranches(tasks, checkpoints, workspaces, target);
    assert.deepEqual(dirty.tasks[0].reasons, ["TARGET_NOT_CLEAN"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("branch preflight rejects unsafe base references", async () => {
  await assert.rejects(preflightHermesBranches([], "/tmp/checkpoints", "/tmp/workspaces", "/tmp/demo", "HEAD~1"), /INVALID_BASE_REF/);
});
