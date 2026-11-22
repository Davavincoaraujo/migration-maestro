import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareIsolatedNextPilot, isolatedNextWorkflow, reactPilotFiles } from "../src/autopilot/isolated-next-pilot.js";
import { validateSyntheticPlan } from "../src/autopilot/synthetic-plan-contract.js";
import { mapping, planFixture } from "./fixtures/synthetic-plan.js";
test("isolated scaffold creates no implementation, is idempotent, and rejects the historical job", async () => {
  const base = await mkdtemp(join(tmpdir(), "isolated-next-")), id = "1".repeat(20);
  try {
    const { root, project } = await prepareIsolatedNextPilot(base, id);
    assert.deepEqual(await readdir(join(project, "src/app")), []);
    assert.match(await readFile(join(project, "next.config.mjs"), "utf8"), /outputFileTracingRoot/);
    const bytes = await readFile(join(project, "package.json"), "utf8");
    await prepareIsolatedNextPilot(base, id);
    assert.equal(await readFile(join(project, "package.json"), "utf8"), bytes);
    await assert.rejects(prepareIsolatedNextPilot(base, "20261116000000000005"), /NEW_ISOLATED_JOB_REQUIRED/);
    const workflow = isolatedNextWorkflow(root, project, id);
    assert.match(workflow.instructions("IMPLEMENT", root), /Generate REAL React\/Next.js/);
    assert.match(workflow.instructions("IMPLEMENT", root), /heroHeading/);
    assert.match(workflow.instructions("VALIDATE", root), /Independently inspect/);
    const config = JSON.parse(await readFile(join(project, "tsconfig.json"), "utf8")); config.compilerOptions.strict = false;
    await writeFile(join(project, "tsconfig.json"), JSON.stringify(config));
    await assert.rejects(prepareIsolatedNextPilot(base, id), /ISOLATED_COMPILER_CONFIG_CHANGED/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
test("React file scope is explicitly supplied to the existing PLAN validator; HTML contract remains strict", () => {
  const plan = planFixture("plan-task", "c".repeat(64)); plan.plannedFiles = [...reactPilotFiles]; plan.implementationPlan.file = reactPilotFiles[0];
  const expected = { jobId: mapping.jobId, taskId: plan.taskId, mappingDigest: plan.mappingDigest, mapping };
  validateSyntheticPlan(plan, { ...expected, implementationFiles: reactPilotFiles });
  assert.throws(() => validateSyntheticPlan(plan, expected), /INVALID_PLAN_CONTRACT/);
  plan.plannedFiles.push("package.json");
  assert.throws(() => validateSyntheticPlan(plan, { ...expected, implementationFiles: reactPilotFiles }), /INVALID_PLAN_CONTRACT/);
});
