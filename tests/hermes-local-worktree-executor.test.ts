import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestrateHermesTasks } from "../src/integrations/hermes-task-orchestrator.js";
import { decideApproval } from "../src/integrations/hermes-approval-gate.js";
import { prepareHermesWorkspaces } from "../src/integrations/hermes-workspace-manager.js";
import { prepareLocalWorktree } from "../src/integrations/hermes-local-worktree-executor.js";
import type { ResumeResult } from "../src/integrations/hermes-checkpoint-runner.js";
import type { PageInput } from "../src/integrations/hermes-batch-planner.js";

test("local worktree opt-in creates isolated branch without changing main or dirty files", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-local-worktree-"));
  const portal = join(root, "portal"), output = join(root, "output");
  const checkpoints = join(root, "checkpoints"), workspaces = join(root, "workspaces");
  const tasks = [{ id: "home", route: "/home", components: ["hero"], dependsOn: [] }];
  const runner = async (pages: PageInput[], checkpointDirectory: string): Promise<ResumeResult> => ({
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: 1, planned: 1, reviewRequired: 0, reused: 0, executed: 1,
    checkpointDirectory, results: [{ id: pages[0].id, status: "planned", reason: "VALID" }]
  });
  try {
    await mkdir(portal); await mkdir(output);
    execFileSync("git", ["init", "-q", "-b", "main", portal]);
    execFileSync("git", ["-C", portal, "-c", "user.name=Test", "-c", "user.email=test@example.com",
      "commit", "-q", "--allow-empty", "-m", "init"]);
    const sha = execFileSync("git", ["-C", portal, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    await orchestrateHermesTasks(tasks, checkpoints, runner);
    await decideApproval(tasks, checkpoints, "home", "approved", "reviewer");
    await prepareHermesWorkspaces(tasks, checkpoints, workspaces);
    const dry = await prepareLocalWorktree(tasks, checkpoints, workspaces, portal, output, "home", sha);
    assert.equal(dry.status, "planned");
    assert.equal(execFileSync("git", ["-C", portal, "branch", "--list", dry.branch], { encoding: "utf8" }).trim(), "");
    const created = await prepareLocalWorktree(tasks, checkpoints, workspaces, portal, output, "home", sha, true);
    assert.equal(created.status, "created");
    assert.equal(created.mergeAuthorized, false);
    assert.equal(execFileSync("git", ["-C", portal, "rev-parse", "main"], { encoding: "utf8" }).trim(), sha);
    assert.equal(execFileSync("git", ["-C", created.path, "branch", "--show-current"], { encoding: "utf8" }).trim(), created.branch);
    assert.match(await readFile(join(output, ".maestro-worktree-audit.jsonl"), "utf8"), /worktree-created/);
    await assert.rejects(prepareLocalWorktree(tasks, checkpoints, workspaces, portal, output, "home", sha, true), /WORKTREE_PATH_EXISTS|BRANCH_EXISTS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
