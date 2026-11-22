import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationStatus, resumeMigration } from "../src/autopilot/migration-status.js";
import { recordMigrationRequest, updateMigrationRecord } from "../src/autopilot/natural-language-intake.js";
import { stages, migrationStages } from "../src/autopilot/central-controller.js";
test("status includes paused synthetic/local jobs and has no writes or agent calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-status-"));
  try {
    const registry = join(root, "registry"), synthetic = join(root, "synthetic");
    for (const [base, id, pipeline] of [[synthetic, "a".repeat(20), stages], [join(registry, "runs"), "b".repeat(20), migrationStages]] as const) {
      const dir = join(base, id); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "status.json"), JSON.stringify({ stage: "PLAN", status: "paused" }));
      await writeFile(join(dir, `${id}.checkpoint.json`), JSON.stringify({ completed: pipeline.slice(0, pipeline.indexOf("PLAN") + 1).map(s => s.toLowerCase().replaceAll("_", "-")) }));
    }
    const before = await readdir(registry);
    const report = await migrationStatus(undefined, registry, synthetic);
    assert.equal(report.jobs.length, 2); assert.equal(report.jobs[0].status, "paused");
    assert.equal(report.jobs[0].completed, 3); assert.equal(report.jobs[1].completed, 4);
    assert.equal(report.writesPerformed, false); assert.deepEqual(await readdir(registry), before);
    await assert.rejects(migrationStatus("unknown", registry, synthetic), /MIGRATION_NOT_FOUND/);
    await assert.rejects(resumeMigration("unknown", { directory: registry }), /MIGRATION_NOT_FOUND/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("completed resume by record ID returns existing run without dispatch or content writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-resume-"));
  try {
    const record = await recordMigrationRequest(root, "https://example.com/page");
    record.status = "awaiting-human-review"; await updateMigrationRecord(root, record);
    const bytes = await readFile(join(root, "migrations.json"), "utf8");
    const result = await resumeMigration(record.id, { directory: root, historicalDirectory: join(root, "absent"), transport: async () => { throw Error("MUST_NOT_DISPATCH"); } });
    assert.equal(result.executed, false); assert.equal(await readFile(join(root, "migrations.json"), "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("simplified CLI creates a stable blocked job, reports it, and resumes without dispatch", async () => {
  const { execFile, execFileSync } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const { realpath } = await import("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "migration-cli-")));
  try {
    const project = join(root, "portal"); await mkdir(project); execFileSync("git", ["init", "-q", project]);
    await mkdir(join(root, "config"));
    await writeFile(join(root, "config/model-router.json"), await readFile(new URL("../config/model-router.json", import.meta.url)));
    const fake = join(root, "fake-maestri");
    await writeFile(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');const [cmd]=process.argv.slice(2);fs.appendFileSync('calls.log',cmd+'\\n');if(cmd==='list') console.log('name: "Analytics"\\nname: "UE-Pattern"\\nname: "Hermes"');else if(cmd==='check') console.log('GPT-6-Astra default · fixture');else process.exit(9);`, { mode: 0o700 });
    const cli = async (name: string, args: string[]) => {
      try {
        return JSON.parse((await promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL(`../src/${name}`, import.meta.url)), ...args], { cwd: root, env: { ...process.env, MAESTRI_CLI: fake, MAESTRO_AEM_AUTHOR_URL: "", MAESTRO_AEM_USER: "", MAESTRO_AEM_PASSWORD: "" } })).stdout);
      } catch (e) { return JSON.parse((e as { stdout: string }).stdout); }
    };
    const first = await cli("cli-maestro-migrate-main.ts", ["--url", "https://example.com/page", "--target", "/content/site/new", "--page-root", "/content/site", "--project", project, "--autopilot"]);
    assert.equal(first.blocked, true); assert.equal(first.record.aemPage, "/content/site/new");
    const id = first.record.executions[0].jobId;
    const resumed = await cli("cli-maestro-resume.ts", [id]);
    assert.equal(resumed.record.executions[0].jobId, id); assert.equal(resumed.blocked, true);
    const status = await cli("cli-maestro-status.ts", [id]);
    assert.equal(status.jobs[0].total, 9); assert.equal(status.jobs[0].completed, 0);
    assert.equal(status.records[0].executionConfig.project, project);
    assert.doesNotMatch(await readFile(join(root, "calls.log"), "utf8"), /ask/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
