import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createIsolatedWorktree } from "../src/integrations/autopilot-isolated-worktree.js";
import { createTaskPacket } from "../src/integrations/autopilot-task-packet.js";
import type { CompatibilityAssessment } from "../src/integrations/component-compatibility.js";
import type { UeValidationGate } from "../src/integrations/ue-validation-gate.js";
test("isolation uses committed HEAD and leaves modified source intact", async () => {
 const root = await mkdtemp(join(tmpdir(), "maestro-isolation-"));
 const project = join(root, "project"), output = join(root, "output");
 const componentPath = "principal/sections/banner/v1";
 const definition = join(project, "src/frontend/components", componentPath, "definition.ts");
 await mkdir(join(project, "src/frontend/components", componentPath), { recursive: true });
 await mkdir(output);
 let worktree = "";
 try {
  execFileSync("git", ["init", "-q", project]);
  await writeFile(definition, "export const original = 1;\n");
  execFileSync("git", ["-C", project, "add", "."]);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial"]);
  await writeFile(definition, "export const modified = 2;\n");
  const compat: CompatibilityAssessment = { decision: "adapt_candidate", status: "review_required", required: 1, matched: 0, missing: 1, unsupportedEvidence: false };
  const gate: UeValidationGate = { status: "review_required", validation: "passed", cliSucceeded: true, humanApprovalRequired: true, errors: 0, warnings: 0, infos: 0 };
  const packet = createTaskPacket(compat, gate, true);
  await assert.rejects(createIsolatedWorktree({ cliDirectory: project, projectDirectory: project }, componentPath, packet, project), /UNSAFE_WORKTREE_LOCATION/);
  const result = await createIsolatedWorktree({ cliDirectory: project, projectDirectory: project }, componentPath, packet, output);
  worktree = result.worktreePath;
  assert.equal(result.agentExecuted, false);
  assert.equal(result.sourceWorktreeUntouched, true);
  assert.equal(await readFile(join(worktree, "src/frontend/components", componentPath, "definition.ts"), "utf8"), "export const original = 1;\n");
  assert.equal(await readFile(definition, "utf8"), "export const modified = 2;\n");
 } finally {
  if (worktree) execFileSync("git", ["-C", project, "worktree", "remove", "--force", worktree]);
  await rm(root, { recursive: true, force: true });
 }
});
