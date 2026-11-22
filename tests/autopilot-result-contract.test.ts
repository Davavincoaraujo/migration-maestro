import { runCentralDemo } from "./fixtures/verified-sessions.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demo, stages, type CentralWorkflow, type StageResultV2 } from "../src/autopilot/central-controller.js";
import { dispatchDigest, executePendingDispatch, type DispatchRequest } from "../src/autopilot/dispatch-executor.js";
import type { MaestriTransport } from "../src/integrations/maestri-central-cli.js";

const id = "b".repeat(20);
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
async function json(file: string) { return JSON.parse(await readFile(file, "utf8")); }
async function fixture(workflow?: CentralWorkflow, cliLayout = false) {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "result-contract-")));
  const directory = cliLayout ? join(sandbox, ".local-maestro/central-demo") : sandbox;
  await mkdir(directory, { recursive: true });
  const root = join(directory, id);
  const calls: string[] = [];
  const transport: MaestriTransport = async (command, args) => {
    calls.push(`${command}:${args[0] ?? ""}`);
    if (command === "list") return ['Analytics', 'UE-Pattern', 'Hermes'].map(name => `name: "${name}"`).join("\n");
    if (command === "check") return `${args[0] === "Hermes" ? "GPT-6-Astra" : "GPT-6.1-Sol"} default · fixture`;
    throw Error("TEST_MUST_NOT_SEND_THROUGH_CONTROLLER");
  };
  let catalogCalls = 0;
  const options = { directory, id, transport, executor: "deferred" as const, pauseAfter: "ANALYZE" as const,
    workflow, maxPolls: 1, pollMs: 0, catalog: async () => { catalogCalls++; throw Error("UNEXPECTED_CATALOG_CALL"); } };
  await assert.rejects(runCentralDemo(options), /analyze/);
  const request = await json(join(root, "ANALYZE.dispatch.json")) as DispatchRequest;
  assert.equal(request.resultContractVersion, 2);
  assert.equal(request.agentId, "Analytics");
  let sends = 0;
  const claim = () => executePendingDispatch(root, "ANALYZE", {
    identity: { executorId: "fixture", terminalId: "authorized-original-terminal" },
    execute: async () => { sends++; throw Error("MAESTRI_TIMEOUT"); },
  });
  const result = async (): Promise<StageResultV2> => {
    const bytes = JSON.stringify({ title: demo.title, cta: demo.cta, target: "#garden", limitations: ["fixture only"] });
    await writeFile(join(root, "ANALYZE.evidence.json"), bytes);
    return { version: 2, jobId: id, taskId: request.taskId, stage: "ANALYZE", status: "completed", summary: "Synthetic inventory", evidence: ["Read fixed synthetic fixture"], artifacts: [{ file: "ANALYZE.evidence.json", digest: digest(bytes) }] };
  };
  const save = (value: unknown) => writeFile(join(root, "ANALYZE.result.json"), JSON.stringify(value));
  return { directory, sandbox, root, options, request, calls, claim, result, save, sends: () => sends, catalogCalls: () => catalogCalls,
    cleanup: () => rm(sandbox, { recursive: true, force: true }) };
}

test("versioned result verifies artifacts, pauses durably before mapping and reuses one uncertain dispatch", async () => {
  const f = await fixture();
  try {
    assert.match(f.request.prompt, /version 2, jobId equal to/);
    assert.match(f.request.prompt, /ANALYZE\.evidence\.json/);
    const outcome = await f.claim();
    assert.equal(outcome.outcome, "unknown");
    await assert.rejects(runCentralDemo(f.options), /analyze/); // exhaust the polling budget
    const originalTask = await json(join(f.root, "ANALYZE.task.json"));
    await assert.rejects(f.claim(), { code: "EEXIST" });
    const result = await f.result();
    await f.save(result);
    const checkpoint = await runCentralDemo(f.options); // late result, same task
    assert.equal(checkpoint.state, "running");
    assert.deepEqual(checkpoint.completed, ["analyze"]);
    const output = checkpoint.outputs.analyze as { resultContractVersion: number; artifacts: unknown; result: StageResultV2 };
    assert.equal(output.resultContractVersion, 2);
    assert.deepEqual(output.artifacts, result.artifacts);
    assert.equal(output.result.taskId, originalTask.taskId);
    assert.equal((await json(join(f.root, "status.json"))).status, "paused");
    assert.equal((await json(join(f.root, "ANALYZE.reconciliation.json"))).action, "result-collected");
    const before = await readFile(join(f.root, `${id}.checkpoint.json`), "utf8");
    await runCentralDemo(f.options);
    assert.equal(await readFile(join(f.root, `${id}.checkpoint.json`), "utf8"), before);
    assert.equal((await json(join(f.root, "ANALYZE.task.json"))).taskId, originalTask.taskId);
    assert.equal(f.sends(), 1);
    assert.equal(f.catalogCalls(), 0);
    assert.equal(f.calls.filter(c => c.startsWith("ask:")).length, 0);
    for (const suffix of ["task.json", "route.json", "dispatch.json", "dispatch-attempt.json"]) {
      await assert.rejects(access(join(f.root, `MAP_COMPONENTS.${suffix}`)), { code: "ENOENT" });
    }
    await writeFile(join(f.root, "ANALYZE.evidence.json"), "changed after checkpoint");
    await assert.rejects(runCentralDemo(f.options), /RESULT_ARTIFACT_DIGEST_MISMATCH/);
    assert.equal(f.sends(), 1);
  } finally { await f.cleanup(); }
});

const invalidCases: { name: string; code: string; mutate: (f: Awaited<ReturnType<typeof fixture>>, result: StageResultV2) => unknown | Promise<unknown> }[] = [
  { name: "wrong jobId", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.jobId = "c".repeat(20); } },
  { name: "wrong taskId", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.taskId = "0".repeat(36); } },
  { name: "wrong stage", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.stage = "PLAN"; } },
  { name: "missing version", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { delete (r as Partial<StageResultV2>).version; } },
  { name: "unknown version", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { Object.assign(r, { version: 3 }); } },
  { name: "missing jobId", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { delete (r as Partial<StageResultV2>).jobId; } },
  { name: "missing manifest", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { delete (r as Partial<StageResultV2>).artifacts; } },
  { name: "empty manifest", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.artifacts = []; } },
  { name: "duplicate artifact", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.artifacts.push(r.artifacts[0]); } },
  { name: "too many artifacts", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.artifacts = Array.from({ length: 21 }, (_, i) => ({ file: `${i}.json`, digest: "a".repeat(64) })); } },
  { name: "missing artifact", code: "RESULT_ARTIFACT_MISSING", mutate: f => rm(join(f.root, "ANALYZE.evidence.json")) },
  { name: "malformed hash", code: "INVALID_STAGE_RESULT", mutate: (_, r) => { r.artifacts[0].digest = "not-sha256"; } },
  { name: "mismatched hash", code: "RESULT_ARTIFACT_DIGEST_MISMATCH", mutate: (_, r) => { r.artifacts[0].digest = "0".repeat(64); } },
  { name: "absolute path", code: "INVALID_ARTIFACT_PATH", mutate: (f, r) => { r.artifacts[0].file = join(f.root, "ANALYZE.evidence.json"); } },
  { name: "path traversal", code: "INVALID_ARTIFACT_PATH", mutate: (_, r) => { r.artifacts[0].file = "../outside.json"; } },
  { name: "symlink outside job", code: "INVALID_ARTIFACT_PATH", mutate: async (f, r) => {
    await writeFile(join(f.directory, "outside.json"), "outside");
    await symlink(f.directory, join(f.root, "escape"));
    r.artifacts[0] = { file: "escape/outside.json", digest: digest("outside") };
  } },
  { name: "oversized artifact", code: "INVALID_ARTIFACT_PATH", mutate: f => truncate(join(f.root, "ANALYZE.evidence.json"), 5_000_001) },
  { name: "directory artifact", code: "INVALID_ARTIFACT_PATH", mutate: async (f, r) => { await mkdir(join(f.root, "folder")); r.artifacts[0].file = "folder"; } },
];
for (const scenario of invalidCases) test(`new result rejects ${scenario.name} before checkpoint completion`, async () => {
  const f = await fixture();
  try {
    await f.claim();
    const result = await f.result();
    await scenario.mutate(f, result);
    await f.save(result);
    await assert.rejects(runCentralDemo(f.options), /analyze/);
    const checkpoint = await json(join(f.root, `${id}.checkpoint.json`));
    assert.deepEqual(checkpoint.completed, []);
    assert.equal(checkpoint.outputs.analyze, undefined);
    assert.match(await readFile(join(f.root, "events.jsonl"), "utf8"), new RegExp(scenario.code));
    await assert.rejects(runCentralDemo(f.options), /analyze/);
    assert.equal(f.sends(), 1);
    assert.equal(f.catalogCalls(), 0);
  } finally { await f.cleanup(); }
});

test("attempt surviving interruption without outcome receipt accepts a late result without resend", async () => {
  const f = await fixture();
  try {
    await f.claim();
    await rm(join(f.root, "ANALYZE.dispatch-receipt.json")); // process died after sending
    await assert.rejects(f.claim(), { code: "EEXIST" });
    await f.save(await f.result());
    const checkpoint = await runCentralDemo(f.options);
    assert.deepEqual(checkpoint.completed, ["analyze"]);
    assert.equal((checkpoint.outputs.analyze as { result: StageResultV2 }).result.taskId, f.request.taskId);
    assert.equal(f.sends(), 1);
  } finally { await f.cleanup(); }
});

test("workflow validation merges its verified artifacts without discarding the result manifest", async () => {
  const f = await fixture({
    input: { kind: "contract-fixture" },
    async prepare() {}, instructions: () => "Fixture only",
    async validate(_stage, root) {
      await writeFile(join(root, "workflow.json"), "workflow evidence");
      return { artifacts: [{ file: "workflow.json", digest: digest("workflow evidence") }] };
    },
  });
  try {
    await f.claim();
    const result = await f.result();
    await f.save(result);
    const checkpoint = await runCentralDemo(f.options);
    assert.deepEqual((checkpoint.outputs.analyze as { artifacts: unknown }).artifacts, [
      ...result.artifacts, { file: "workflow.json", digest: digest("workflow evidence") },
    ]);
    await writeFile(join(f.root, "workflow.json"), "changed");
    await assert.rejects(runCentralDemo(f.options), /ARTIFACT_CHANGED/);
    assert.equal(f.sends(), 1);
  } finally { await f.cleanup(); }
});

test("artifact changed during workflow validation cannot enter the completed checkpoint", async () => {
  const f = await fixture({
    input: { kind: "contract-fixture" },
    async prepare() {}, instructions: () => "Fixture only",
    async validate(_stage, root) {
      await writeFile(join(root, "ANALYZE.evidence.json"), "changed after collection");
      return {};
    },
  });
  try {
    await f.claim();
    await f.save(await f.result());
    await assert.rejects(runCentralDemo(f.options), /analyze/);
    assert.deepEqual((await json(join(f.root, `${id}.checkpoint.json`))).completed, []);
    assert.match(await readFile(join(f.root, "events.jsonl"), "utf8"), /RESULT_ARTIFACT_DIGEST_MISMATCH/);
    assert.equal(f.sends(), 1);
  } finally { await f.cleanup(); }
});

test("legacy persisted request resumes under its original contract without upgrading its output", async () => {
  const f = await fixture();
  try {
    const request = { ...f.request };
    delete request.resultContractVersion;
    const task = await json(join(f.root, "ANALYZE.task.json"));
    delete task.resultContractVersion;
    task.requestDigest = dispatchDigest(request);
    await writeFile(join(f.root, "ANALYZE.dispatch.json"), JSON.stringify(request));
    await writeFile(join(f.root, "ANALYZE.task.json"), JSON.stringify(task));
    await f.claim();
    await f.save({ taskId: task.taskId, stage: "ANALYZE", status: "completed", summary: "Historical contract", evidence: ["legacy fixture"] });
    const checkpoint = await runCentralDemo(f.options);
    assert.deepEqual(checkpoint.completed, ["analyze"]);
    assert.equal((checkpoint.outputs.analyze as { resultContractVersion?: number }).resultContractVersion, undefined);
    assert.equal((checkpoint.outputs.analyze as { artifacts?: unknown }).artifacts, undefined);
    assert.equal(await readFile(join(f.root, "ANALYZE.dispatch.json"), "utf8"), JSON.stringify(request));
  } finally { await f.cleanup(); }
});

test("completed historical checkpoint is reused byte-for-byte without a new-contract attestation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "historical-result-"));
  const root = join(directory, id);
  try {
    await mkdir(root);
    const outputs: Record<string, unknown> = {};
    for (const stage of stages.filter(s => s !== "REVIEW")) {
      const result = { taskId: "historical-task", stage, status: "completed", summary: "Legacy fixture", evidence: ["historical fixture"] };
      const raw = JSON.stringify(result);
      await writeFile(join(root, stage + ".result.json"), raw);
      outputs[stage.toLowerCase().replaceAll("_", "-")] = { result, resultDigest: digest(raw) };
    }
    outputs.review = { humanApprovalRequired: true };
    const checkpoint = { version: 1, jobId: id, inputDigest: digest(JSON.stringify({ controllerVersion: 1, demo, root })), completed: stages.map(s => s.toLowerCase().replaceAll("_", "-")), outputs, state: "awaiting-review" };
    const original = JSON.stringify(checkpoint, null, 2);
    await writeFile(join(root, `${id}.checkpoint.json`), original);
    const transport: MaestriTransport = async command => {
      assert.equal(command, "list");
      return ['Analytics', 'UE-Pattern', 'Hermes'].map(name => `name: "${name}"`).join("\n");
    };
    const resumed = await runCentralDemo({ directory, id, transport, executor: "deferred" });
    assert.deepEqual(resumed.outputs, outputs);
    assert.equal(await readFile(join(root, `${id}.checkpoint.json`), "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real central and dispatch CLIs prepare, execute once and reconcile ANALYZE with a fake official executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "analytics-cli-contract-"));
  try {
    await mkdir(join(directory, "config"));
    await writeFile(join(directory, "config/model-router.json"), await readFile(new URL("../config/model-router.json", import.meta.url)));
    const fake = join(directory, "fake-maestri");
    await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [command,...args] = process.argv.slice(2);
fs.appendFileSync('calls.log',command+':'+(command==='ask'?args[0]:'')+'\\n');
if(command==='list') console.log(['Analytics','UE-Pattern','Hermes'].map(name=>'name: "'+name+'"').join('\\n'));
else if(command==='check') console.log((args[0]==='Hermes'?'GPT-6-Astra':'GPT-6.1-Sol')+' default · fixture');
else if(command==='ask') {
  const [,taskId,stage] = args[1].match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/);
  if(stage!=='ANALYZE' || args[0]!=='Analytics') process.exit(2);
  const [,file] = args[1].match(/Write a JSON result file at (.+) with taskId equal to/);
  const bytes=JSON.stringify({findings:['synthetic fixture'],limitations:['fake CLI only']});
  const artifact=stage+'.evidence.json';
  fs.writeFileSync(path.join(path.dirname(file),artifact),bytes);
  fs.writeFileSync(file,JSON.stringify({version:2,jobId:path.basename(path.dirname(file)),taskId,stage,status:'completed',summary:'Fixture',evidence:['fixture'],artifacts:[{file:artifact,digest:crypto.createHash('sha256').update(bytes).digest('hex')}]}));
  console.log('command returned');
} else process.exit(3);
`, { mode: 0o700 });
    const cli = (file: string, args: string[]) => promisify(execFile)(process.execPath,
      ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL(file === "cli-autopilot-central.ts" ? "./fixtures/central-cli.ts" : `../src/${file}`, import.meta.url)), ...args],
      { cwd: directory, env: { ...process.env, MAESTRI_CLI: fake }, timeout: 15000 });
    const flags = [id, "--defer-dispatch", "--pause-after-analyze"];
    await assert.rejects(cli("cli-autopilot-central.ts", flags), /Checkpointed stage failed: analyze/);
    const root = join(directory, ".local-maestro/central-demo", id);
    assert.equal((await json(join(root, "failure.json"))).error, "Checkpointed stage failed: analyze");
    assert.match(await readFile(join(root, "events.jsonl"), "utf8"), /AUTHORIZED_EXECUTOR_REQUIRED/);
    assert.doesNotMatch(await readFile(join(directory, "calls.log"), "utf8"), /ask:/);
    await cli("cli-autopilot-dispatch.ts", [root, "ANALYZE"]);
    const resumed = JSON.parse((await cli("cli-autopilot-central.ts", flags)).stdout);
    assert.deepEqual(resumed.completed, ["analyze"]);
    assert.equal(resumed.paused, true);
    assert.equal(resumed.pauseAfter, "ANALYZE");
    assert.equal(resumed.state, "running");
    const original = await readFile(join(root, `${id}.checkpoint.json`), "utf8");
    await cli("cli-autopilot-central.ts", flags);
    assert.equal(await readFile(join(root, `${id}.checkpoint.json`), "utf8"), original);
    assert.equal((await readFile(join(directory, "calls.log"), "utf8")).split("\n").filter(line => line.startsWith("ask:")).length, 1);
    await assert.rejects(access(join(root, "MAP_COMPONENTS.dispatch.json")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("mapping v1 resumes Analytics once, rejects invalid handoff and pauses before Hermes", async () => {
  const f = await fixture();
  try {
    await f.claim(); await f.save(await f.result()); await runCentralDemo(f.options);
    const analyze = await readFile(join(f.root, "ANALYZE.task.json"), "utf8");
    const options = { ...f.options, pauseAfter: "MAP_COMPONENTS" as const, syntheticMappingContract: true };
    await assert.rejects(runCentralDemo(options), /map-components/);
    const request = await json(join(f.root, "MAP_COMPONENTS.dispatch.json"));
    assert.equal(request.mappingContractVersion, 1);
    assert.equal(request.agentId, "UE-Pattern");
    assert.match(request.prompt, /MAP_COMPONENTS.mapping.json/);
    let sends = 0;
    await executePendingDispatch(f.root, "MAP_COMPONENTS", { identity: { executorId: "fixture" }, execute: async () => { sends++; return "fixture"; } });
    const mapping = {
      version: 1, jobId: id, taskId: request.taskId, stage: "MAP_COMPONENTS", scope: "synthetic-only", corporateReuseVerified: false,
      analyzeResultDigest: digest(await readFile(join(f.root, "ANALYZE.result.json"), "utf8")),
      mapping: { source: "hero", component: "semantic-hero", heading: demo.title, cta: demo.cta, href: "#garden", targetId: "garden" },
      semantics: ["main and h1"], responsiveRequirements: ["No horizontal overflow"], gaps: ["No real component validated"], limitations: ["Synthetic only"],
    };
    const saveMapping = async (value: unknown) => {
      const raw = JSON.stringify(value), evidence = JSON.stringify({ findings: ["synthetic hero"], limitations: ["No corporate match"] });
      await writeFile(join(f.root, "MAP_COMPONENTS.mapping.json"), raw);
      await writeFile(join(f.root, "MAP_COMPONENTS.evidence.json"), evidence);
      await writeFile(join(f.root, "MAP_COMPONENTS.result.json"), JSON.stringify({ version: 2, jobId: id, taskId: request.taskId, stage: "MAP_COMPONENTS", status: "completed", summary: "Mapped synthetic hero", evidence: ["Read Analytics result"], artifacts: [{ file: "MAP_COMPONENTS.mapping.json", digest: digest(raw) }, { file: "MAP_COMPONENTS.evidence.json", digest: digest(evidence) }] }));
    };
    await saveMapping({ ...mapping, analyzeResultDigest: "0".repeat(64) });
    await assert.rejects(runCentralDemo(options), /map-components/);
    assert.deepEqual((await json(join(f.root, `${id}.checkpoint.json`))).completed, ["analyze"]);
    await saveMapping(mapping);
    const completed = await runCentralDemo(options);
    assert.deepEqual(completed.completed, ["analyze", "map-components"]);
    assert.equal(completed.state, "running");
    assert.equal((await json(join(f.root, "status.json"))).pauseAfter, "MAP_COMPONENTS");
    const before = await readFile(join(f.root, `${id}.checkpoint.json`), "utf8");
    await runCentralDemo(options);
    assert.equal(await readFile(join(f.root, `${id}.checkpoint.json`), "utf8"), before);
    assert.equal(await readFile(join(f.root, "ANALYZE.task.json"), "utf8"), analyze);
    assert.equal(sends, 1); assert.equal(f.sends(), 1); assert.equal(f.catalogCalls(), 0);
    for (const suffix of ["task.json", "route.json", "dispatch.json", "dispatch-attempt.json"]) await assert.rejects(access(join(f.root, `PLAN.${suffix}`)), { code: "ENOENT" });
    await writeFile(join(f.root, "MAP_COMPONENTS.mapping.json"), "{}");
    await assert.rejects(runCentralDemo(options), /RESULT_ARTIFACT_DIGEST_MISMATCH/);
    assert.equal(sends, 1);
  } finally { await f.cleanup(); }
});

test("PLAN v1 validates the handoff, pauses before any IMPLEMENT work and resumes without replay", async () => {
  const { mapping: template, planFixture } = await import("./fixtures/synthetic-plan.js");
  const f = await fixture(undefined, true);
  try {
    await f.claim(); await f.save(await f.result()); await runCentralDemo(f.options);
    const mapOptions = { ...f.options, pauseAfter: "MAP_COMPONENTS" as const, syntheticMappingContract: true };
    await assert.rejects(runCentralDemo(mapOptions), /map-components/);
    const mapRequest = await json(join(f.root, "MAP_COMPONENTS.dispatch.json"));
    const mapping = { ...template, taskId: mapRequest.taskId, analyzeResultDigest: digest(await readFile(join(f.root, "ANALYZE.result.json"), "utf8")) };
    let mapSends = 0, planSends = 0;
    await executePendingDispatch(f.root, "MAP_COMPONENTS", { identity: { executorId: "fixture" }, execute: async () => { mapSends++; return "fixture"; } });
    const saveStage = async (stage: string, taskId: string, files: Record<string, unknown>) => {
      const artifacts = [];
      for (const [file, value] of Object.entries(files)) {
        const raw = JSON.stringify(value); await writeFile(join(f.root, file), raw); artifacts.push({ file, digest: digest(raw) });
      }
      await writeFile(join(f.root, `${stage}.result.json`), JSON.stringify({ version: 2, jobId: id, taskId, stage, status: "completed", summary: "Synthetic fixture", evidence: ["fixture evidence"], artifacts }));
    };
    await saveStage("MAP_COMPONENTS", mapRequest.taskId, { "MAP_COMPONENTS.mapping.json": mapping, "MAP_COMPONENTS.evidence.json": { scope: "synthetic-only" } });
    const mapped = await runCentralDemo(mapOptions);
    const { readdir } = await import("node:fs/promises");
    const historical = new Map<string, string>();
    for (const file of await readdir(f.root)) if (/^(ANALYZE|MAP_COMPONENTS)\./.test(file)) historical.set(file, await readFile(join(f.root, file), "utf8"));
    const options = { ...mapOptions, pauseAfter: "PLAN" as const };
    await assert.rejects(runCentralDemo(options), /plan/);
    const request = await json(join(f.root, "PLAN.dispatch.json"));
    assert.equal(request.planContractVersion, 1);
    assert.equal(request.mappingDigest, digest(await readFile(join(f.root, "MAP_COMPONENTS.mapping.json"), "utf8")));
    assert.match(request.prompt, /EVERY gaps and limitations entry/);
    assert.match(request.prompt, /IMPLEMENT is not authorized/);
    const taskBefore = await readFile(join(f.root, "PLAN.task.json"), "utf8");
    await executePendingDispatch(f.root, "PLAN", { identity: { executorId: "fixture" }, execute: async () => { planSends++; return "fixture"; } });
    const plan = planFixture(request.taskId, request.mappingDigest, mapping);
    // Even with a matching artifact hash, an invalid inner contract cannot checkpoint PLAN.
    await saveStage("PLAN", request.taskId, { "PLAN.plan.json": { ...plan, mappingDigest: "0".repeat(64) }, "PLAN.evidence.json": { limitations: mapping.limitations } });
    await assert.rejects(runCentralDemo(options), /plan/);
    assert.deepEqual((await json(join(f.root, `${id}.checkpoint.json`))).completed, mapped.completed);
    await saveStage("PLAN", request.taskId, { "PLAN.evidence.json": { limitations: mapping.limitations } });
    await assert.rejects(runCentralDemo(options), /plan/);
    await saveStage("PLAN", request.taskId, { "PLAN.plan.json": plan, "PLAN.evidence.json": { limitations: mapping.limitations } });
    const completed = await runCentralDemo(options);
    assert.deepEqual(completed.completed, ["analyze", "map-components", "plan"]);
    assert.equal(completed.state, "running");
    assert.deepEqual(completed.outputs.analyze, mapped.outputs.analyze);
    assert.deepEqual(completed.outputs["map-components"], mapped.outputs["map-components"]);
    const status = await json(join(f.root, "status.json"));
    assert.equal(status.status, "paused"); assert.equal(status.pauseAfter, "PLAN");
    const checkpoint = await readFile(join(f.root, `${id}.checkpoint.json`), "utf8");
    const planTask = await readFile(join(f.root, "PLAN.task.json"), "utf8");
    assert.equal(JSON.parse(planTask).taskId, JSON.parse(taskBefore).taskId);
    await runCentralDemo(options); await runCentralDemo(options);
    assert.equal(await readFile(join(f.root, `${id}.checkpoint.json`), "utf8"), checkpoint);
    assert.equal(await readFile(join(f.root, "PLAN.task.json"), "utf8"), planTask);
    for (const [file, bytes] of historical) assert.equal(await readFile(join(f.root, file), "utf8"), bytes, file);
    assert.equal(planSends, 1); assert.equal(mapSends, 1); assert.equal(f.sends(), 1); assert.equal(f.catalogCalls(), 0);
    assert.equal(f.calls.filter(c => c.startsWith("ask:")).length, 0);
    assert.equal((await readdir(f.root)).some(file => file.startsWith("IMPLEMENT.")), false);
    assert.doesNotMatch(await readFile(join(f.root, "events.jsonl"), "utf8"), /"stage":"IMPLEMENT"/);
    // CLI reconciliation exercises the new flag through an isolated fake official CLI.
    await mkdir(join(f.sandbox, "config"));
    await writeFile(join(f.sandbox, "config/model-router.json"), await readFile(new URL("../config/model-router.json", import.meta.url)));
    const fake = join(f.sandbox, "fake-maestri");
    await writeFile(fake, `#!/usr/bin/env node\nconst [cmd]=process.argv.slice(2); if(cmd==='list') console.log('name: "Analytics"\\nname: "UE-Pattern"\\nname: "Hermes"'); else if(cmd==='check') console.log('GPT-6-Astra default · fixture'); else process.exit(9);`, { mode: 0o700 });
    const cli = (flags: string[]) => promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL("./fixtures/central-cli.ts", import.meta.url)), id, ...flags], { cwd: f.sandbox, env: { ...process.env, MAESTRI_CLI: fake } });
    const output = JSON.parse((await cli(["--defer-dispatch", "--synthetic-mapping-v1", "--pause-after-plan"])).stdout);
    assert.equal(output.paused, true); assert.equal(output.pauseAfter, "PLAN");
    for (const flag of ["--pause-after-analyze", "--pause-after-map-components"]) await assert.rejects(cli(["--pause-after-plan", flag]), /CONFLICTING_PAUSE_FLAGS/);
    assert.equal(await readFile(join(f.root, `${id}.checkpoint.json`), "utf8"), checkpoint);
    assert.equal((await readdir(f.root)).some(file => file.startsWith("IMPLEMENT.")), false);
    // Accepted PLAN remains hash-checked on every resume.
    await writeFile(join(f.root, "PLAN.plan.json"), "{}");
    await assert.rejects(runCentralDemo(options), /RESULT_ARTIFACT_DIGEST_MISMATCH/);
    assert.equal(planSends, 1);
  } finally { await f.cleanup(); }
});
