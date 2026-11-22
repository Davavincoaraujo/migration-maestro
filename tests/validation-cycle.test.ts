import { simulatedDiscovery } from "./fixtures/verified-sessions.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidationCycle, type ValidationPolicy } from "../src/autopilot/validation-cycle.js";
import { sha256 } from "../src/integrations/aem-create-only.js";

test("real local subprocesses fail, receive a scoped repair, retest regressions and preserve hashed evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "validation-process-"));
  try {
    const project = join(root, "project"), evidence = join(root, "evidence"); await mkdir(project);
    await writeFile(join(project, "sum.cjs"), "module.exports=(a,b)=>a-b;");
    await writeFile(join(project, "sum.test.cjs"), `const test=require('node:test');const assert=require('node:assert/strict');const sum=require('./sum.cjs');test('sum',()=>assert.equal(sum(2,3),5));test('regression',()=>assert.equal(sum(0,0),0));`);
    const policy: ValidationPolicy = { maxRepairs: 1, maxDurationMs: 10000, checks: [
      { id: "syntax", command: process.execPath, args: ["--check", "sum.cjs"], timeoutMs: 2000 },
      { id: "unit-regression", command: process.execPath, args: ["--test", "sum.test.cjs"], timeoutMs: 2000 },
    ] };
    const sourceTests = await readFile(join(project, "sum.test.cjs"), "utf8"); let fixes = 0;
    const result = await runValidationCycle({ directory: evidence, project, policy, repair: async context => {
      fixes++; assert.equal(context.attempt, 1); assert.equal(context.failed[0].id, "unit-regression");
      assert.equal(sha256(await readFile(join(evidence, context.failed[0].logFile))), context.failed[0].logDigest);
      await writeFile(join(project, "sum.cjs"), "module.exports=(a,b)=>a+b;");
    } });
    assert.equal(result.status, "passed"); assert.equal(fixes, 1); assert.equal(result.repairs, 1);
    assert.equal(result.checks.length, 2); assert.equal(await readFile(join(project, "sum.test.cjs"), "utf8"), sourceTests);
    for (const check of result.checks) assert.equal(sha256(await readFile(join(evidence, check.logFile))), check.logDigest);
    assert.equal((await readdir(evidence)).filter(f => f.startsWith("report-")).length, 2);
    await runValidationCycle({ directory: evidence, project, policy }); // independently re-executes checks
    assert.equal((await readdir(evidence)).filter(f => f.startsWith("report-")).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("uncertain repair requires reconciliation and never calls the original repair twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-reconciliation-"));
  try {
    const policy: ValidationPolicy = { maxRepairs: 1, maxDurationMs: 10000, checks: [{ id: "test", command: process.execPath, args: ["-e", "process.exit(1)"], timeoutMs: 1000 }] };
    let calls = 0;
    const options = { directory: join(root, "evidence"), project: root, policy, repair: async () => { calls++; throw Error("UNKNOWN_DELIVERY"); } };
    await assert.rejects(runValidationCycle(options), /UNKNOWN_DELIVERY/);
    await assert.rejects(runValidationCycle(options), /REPAIR_RECONCILIATION_REQUIRED/);
    assert.equal(calls, 1);
    let reconciled = 0;
    await assert.rejects(runValidationCycle({ ...options, reconcileRepair: async () => { reconciled++; } }), /VALIDATION_FAILED_CIRCUIT_OPEN/);
    assert.equal(calls, 1); assert.equal(reconciled, 1);
    await assert.rejects(runValidationCycle(options), /VALIDATION_CIRCUIT_OPEN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("authorization and infrastructure failures never trigger model repairs", async () => {
  const root = await mkdtemp(join(tmpdir(), "repair-auth-"));
  try {
    let calls = 0;
    await assert.rejects(runValidationCycle({ directory: join(root, "evidence"), project: root,
      policy: { maxRepairs: 2, maxDurationMs: 10000, checks: [{ id: "auth", command: process.execPath, args: ["-e", "console.error('AUTHENTICATION REQUIRED');process.exit(1)"], timeoutMs: 1000 }] },
      repair: async () => { calls++; },
    }), /VALIDATION_FAILED_CIRCUIT_OPEN/);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair child uses central receipts and ADVANCED routing, reconciles timeout, and never resends", async () => {
  const { maestriRepair } = await import("../src/autopilot/maestri-repair.js");
  const root = await mkdtemp(join(tmpdir(), "repair-child-"));
  try {
    const project = join(root, "portal"); await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src/hero.ts"), "export const value=0;");
    await writeFile(join(root, "plan.json"), JSON.stringify({ files: ["src/hero.ts"] }));
    const log = "assertion failed in src/hero.ts"; await writeFile(join(root, "failed.log"), log);
    let sends = 0;
    const repair = maestriRepair({ discoverSessions: simulatedDiscovery, root, parentJobId: "f".repeat(20), project, allowedFiles: ["src/hero.ts"], transport: async (command, args) => {
      if (command === "list") return 'name: "Hermes"';
      if (command === "check") return 'GPT-6-Astra default · fixture';
      sends++;
      const match = args[1].match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/)!;
      const file = args[1].match(/Write a JSON result file at (.+) with taskId equal to/)![1];
      const { dirname, basename } = await import("node:path"); const dir = dirname(file);
      await writeFile(join(project, "src/hero.ts"), "export const value=1;");
      const manifest = JSON.stringify({ version: 1, diagnosis: "Fixture constant was incorrect", changedFiles: [{ file: "src/hero.ts", digest: sha256(await readFile(join(project, "src/hero.ts"))) }] });
      await writeFile(join(dir, "repair.json"), manifest);
      await writeFile(file, JSON.stringify({ version: 2, jobId: basename(dir), taskId: match[1], stage: "IMPLEMENT", status: "completed", summary: "Fixture correction", evidence: ["Simulated specialist; no live integration claimed"], artifacts: [{ file: "repair.json", digest: sha256(manifest) }] }));
      throw Error("MAESTRI_TIMEOUT");
    } });
    const context = { attempt: 1, directory: root, remainingMs: 10000, failed: [{ id: "unit", status: "failed" as const, exitCode: 1, failureKind: "quality" as const, logFile: "failed.log", logDigest: sha256(log), durationMs: 1 }] };
    await repair(context); await repair(context);
    assert.equal(sends, 1);
    const child = (await readdir(join(root, "repairs"))).find(f => /^[a-f0-9]{20}$/.test(f))!;
    const route = JSON.parse(await readFile(join(root, "repairs", child, "IMPLEMENT.route.json"), "utf8"));
    assert.equal(route.selected.profile, "ADVANCED");
    await writeFile(join(project, "src/hero.ts"), "tampered");
    await assert.rejects(repair(context), /REPAIR_FILE_CHANGED/);
    assert.equal(sends, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
