import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { decideApproval } from "../src/integrations/hermes-approval-gate.js";
import { prepareHermesWorkspaces } from "../src/integrations/hermes-workspace-manager.js";
import { planHermesGitWorkspaces } from "../src/integrations/hermes-git-workspace-adapter.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("git plan is deterministic, read-only and rejects missing or tampered manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-git-plan-"));
  const checkpoints = join(root, "checkpoints"), workspaces = join(root, "workspaces");
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
    await orchestrateHermesTasks(tasks, checkpoints, runner);
    await decideApproval(tasks, checkpoints, "home", "approved", "reviewer");
    await decideApproval(tasks, checkpoints, "products", "approved", "reviewer");
    const missing = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(missing.blocked, 2);
    assert.ok(missing.tasks[0].reasons.includes("WORKSPACE_NOT_VERIFIED"));
    const prepared = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    const first = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
    const second = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
    assert.deepEqual(first, second);
    assert.equal(first.planned, 2);
    assert.equal(first.gitOperationsPerformed, false);
    assert.equal(first.codeExecutionAuthorized, false);
    assert.match(first.tasks[0].branch!, /^maestro\/home-[a-f0-9]{12}$/);
    await writeFile(join(prepared.workspaces[0].path, "manifest.json"), "{}");
    const tampered = await planHermesGitWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(tampered.planned, 1);
    assert.equal(tampered.tasks[0].status, "blocked");
  } finally { await rm(root, { recursive: true, force: true }); }
});
