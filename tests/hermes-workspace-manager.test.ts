import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { decideApproval } from "../src/integrations/hermes-approval-gate.js";
import { prepareHermesWorkspaces } from "../src/integrations/hermes-workspace-manager.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("workspace manager creates only approved metadata workspaces and reuses safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-workspace-"));
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
    const blocked = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(blocked.prepared, 0);
    assert.equal(blocked.blocked.length, 2);
    await decideApproval(tasks, checkpoints, "home", "approved", "reviewer");
    const partial = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(partial.prepared, 1);
    assert.equal(partial.blocked.length, 1);
    const first = JSON.parse(await readFile(join(partial.workspaces[0].path, "manifest.json"), "utf8"));
    assert.equal(first.codeExecutionAuthorized, false);
    assert.equal(first.publishingAuthorized, false);
    await decideApproval(tasks, checkpoints, "products", "approved", "reviewer");
    const ready = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(ready.prepared, 1);
    assert.equal(ready.reused, 1);
    const again = await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    assert.equal(again.reused, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
