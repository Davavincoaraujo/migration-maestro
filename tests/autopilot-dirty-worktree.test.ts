import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareLocalHandoff } from "../src/integrations/autopilot-local-handoff.js";
import { createTaskPacket } from "../src/integrations/autopilot-task-packet.js";
import type { CompatibilityAssessment } from "../src/integrations/component-compatibility.js";
import type { UeValidationGate } from "../src/integrations/ue-validation-gate.js";
test("dirty tracked project remains untouched during read-only handoff", async () => {
 const root = await mkdtemp(join(tmpdir(), "maestro-handoff-"));
 const project = join(root, "project");
 const component = join(project, "src/frontend/components/principal/sections/banner/v1");
 const output = join(process.cwd(), "local-output");
 await mkdir(component, { recursive: true });
 await mkdir(output, { recursive: true });
 const definition = join(component, "definition.ts");
 try {
  execFileSync("git", ["init", "-q", project]);
  await writeFile(definition, "export const original = 1;\n");
  execFileSync("git", ["-C", project, "add", "."]);
  execFileSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial"]);
  await writeFile(definition, "export const modified = 2;\n");
  const compatibility: CompatibilityAssessment = { decision: "adapt_candidate", status: "review_required", required: 1, matched: 0, missing: 1, unsupportedEvidence: false };
  const gate: UeValidationGate = { status: "review_required", validation: "passed", cliSucceeded: true, humanApprovalRequired: true, errors: 0, warnings: 0, infos: 0 };
  const result = await prepareLocalHandoff({ cliDirectory: project, projectDirectory: project }, "principal/sections/banner/v1", createTaskPacket(compatibility, gate, true), output);
  assert.equal(result.worktree, "modified");
  assert.equal(result.executionAuthorized, false);
  assert.equal(await readFile(definition, "utf8"), "export const modified = 2;\n");
 } finally {
  await rm(root, { recursive: true, force: true });
  const { readdir, unlink } = await import("node:fs/promises");
  for (const name of await readdir(output)) if (name.startsWith("handoff-principal_sections_banner_v1-")) await unlink(join(output, name));
 }
});
