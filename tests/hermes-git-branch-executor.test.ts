import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preflightHermesBranches } from "../src/integrations/hermes-git-branch-executor.js";

test("branch preflight refuses an unmarked target before any git operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-branch-preflight-"));
  try {
    await assert.rejects(
      preflightHermesBranches([], join(root, "checkpoints"), join(root, "workspaces"), root),
      /DEMO_REPOSITORY_MARKER_REQUIRED/
    );
    await writeFile(join(root, ".maestro-demo-repo"), "demo\n");
    await assert.rejects(
      preflightHermesBranches([], join(root, "checkpoints"), join(root, "workspaces"), root),
      /not a git repository|Command failed/i
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("branch preflight rejects unsafe base references", async () => {
  await assert.rejects(
    preflightHermesBranches([], "/tmp/checkpoints", "/tmp/workspaces", "/tmp/demo", "HEAD~1"),
    /INVALID_BASE_REF/
  );
});
