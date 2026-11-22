import { runCentralDemo } from "./fixtures/verified-sessions.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demo, stages, validateDemoHtml, validateResult } from "../src/autopilot/central-controller.js";
import { maestriTransport, type MaestriTransport } from "../src/integrations/maestri-central-cli.js";

import { createHash } from "node:crypto";

const id = "a".repeat(20);
const html = `<html lang="en"><style>@media(max-width:600px){main{padding:1rem}}</style><main><h1>${demo.title}</h1><a href="#garden">${demo.cta}</a><section id="garden">A synthetic garden</section></main></html>`;
const catalog = async () => [{ type: "text", text: JSON.stringify({ matches: [{ id: "synthetic-catalog-fixture" }] }) }];
const listing = 'Connected agents:\n  - name: "Analytics"\n  - name: "UE-Pattern"\n  - name: "Hermes"\nConnected portals:';
async function writeResult(root: string, taskId: string, stage: string) {
  const file = stage + ".evidence.json";
  const bytes = JSON.stringify({ findings: ["synthetic fixture evidence"], stage });
  await writeFile(join(root, file), bytes);
  const result = { version: 2, jobId: id, taskId, stage, status: "completed", summary: "fixture checked", evidence: ["synthetic fixture evidence"], artifacts: [{ file, digest: createHash("sha256").update(bytes).digest("hex") }] };
  await writeFile(join(root, stage + ".result.json"), JSON.stringify(result));
  return result;
}
function responder(root: string, calls: string[], failStage?: string): MaestriTransport {
  let pending: { stage: string; taskId: string } | undefined;
  return async (command, args) => {
    calls.push(command + ":" + (args[0] ?? ""));
    if (command === "list") return listing;
    if (command === "check" && !pending) {
      const model = args[0] === "Hermes" ? "GPT-6-Astra" : "GPT-6.1-Sol";
      return `${model} default · ~/Developer/migration-maestro · idle`;
    }
    if (command === "ask") {
      const match = args[1].match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/)!;
      pending = { taskId: match[1], stage: match[2] };
      throw Error("MAESTRI_TIMEOUT"); // Timed-out send must be reconciled by check, never resent.
    }
    if (pending && pending.stage !== failStage) {
      if (pending.stage === "IMPLEMENT") await writeFile(join(root, id, "index.html"), html);
      await writeResult(join(root, id), pending.taskId, pending.stage);
    }
    return "agent output";
  };
}
test("stage result identity and static demo contract reject invalid evidence", () => {
  assert.throws(() => validateResult('{"status":"completed"}', "PLAN", "x"));
  validateDemoHtml(html);
  assert.throws(() => validateDemoHtml(html + '<script>alert(1)</script>'));
  assert.throws(() => validateDemoHtml(html.replace("#garden", "https://example.com")));
});
test("sequential gates, timeout reconciliation, durable reuse and changed evidence rejection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-test-"));
  try {
    const calls: string[] = [];
    const transport = responder(directory, calls);
    const opts = { directory, id, transport, catalog, maxPolls: 2, pollMs: 0 };
    const state = await runCentralDemo(opts);
    assert.equal(state.state, "awaiting-review");
    assert.deepEqual(state.completed, stages.map(s => s.toLowerCase().replaceAll("_", "-")));
    const analyzeRoute = JSON.parse(await readFile(join(directory, id, "ANALYZE.route.json"), "utf8"));
    const planRoute = JSON.parse(await readFile(join(directory, id, "PLAN.route.json"), "utf8"));
    const history = JSON.parse(await readFile(join(directory, "model-router-history.json"), "utf8"));
    assert.equal(analyzeRoute.selected.profile, "ECONOMY");
    assert.equal(analyzeRoute.selected.modelProfile, "BALANCED");
    assert.equal(planRoute.selected.profile, "ADVANCED");
    assert.equal(history.entries.length, 5);
    assert.ok(history.entries.every((entry: { outcome: string }) => entry.outcome === "success"));
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 5);
    assert.equal(calls.filter(c => c.startsWith("check:")).length, 8);
    const before = calls.length;
    await runCentralDemo(opts);
    assert.deepEqual(calls.slice(before), []);
    await writeFile(join(directory, id, "index.html"), html + "changed");
    await assert.rejects(runCentralDemo(opts), /IMPLEMENTATION_CHANGED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("exhausted checks block successors and resume never duplicates an uncertain send", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-retry-"));
  try {
    const calls: string[] = [];
    const opts = { directory, id, transport: responder(directory, calls, "ANALYZE"), catalog, maxPolls: 2, pollMs: 0 };
    await assert.rejects(runCentralDemo(opts), /analyze/);
    await assert.rejects(runCentralDemo(opts), /analyze/);
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 1);
    assert.equal(calls.filter(c => c.startsWith("check:")).length, 8);
    const receipt = JSON.parse(await readFile(join(directory, id, "ANALYZE.task.json"), "utf8"));
    await writeResult(join(directory, id), receipt.taskId, "ANALYZE");
    // A fresh transport is allowed; a late ANALYZE result is reused, not dispatched again.
    const resumed: string[] = [];
    await runCentralDemo({ ...opts, transport: responder(directory, resumed) });
    assert.equal(resumed.filter(c => c.startsWith("ask:")).length, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("catalog failure prevents MAP_COMPONENTS dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-catalog-"));
  try {
    const calls: string[] = [];
    await assert.rejects(runCentralDemo({ directory, id, transport: responder(directory, calls), catalog: async () => [], pollMs: 0 }), /map-components/);
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("invalid specialist result blocks successor and controller lock fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-invalid-"));
  try {
    const calls: string[] = [];
    const delegate = responder(directory, calls);
    const transport: MaestriTransport = async (command, args) => {
      const response = await delegate(command, args);
      if (command === "check") await writeFile(join(directory, id, "ANALYZE.result.json"), '{"status":"completed"}');
      return response;
    };
    await assert.rejects(runCentralDemo({ directory, id, transport, catalog, pollMs: 0 }), /analyze/);
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 1);
    await writeFile(join(directory, "controller.lock"), "operator reconciliation required");
    await assert.rejects(runCentralDemo({ directory, id, transport, catalog }), /LOCKED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("integration: full pipeline across official CLI subprocesses with persisted artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-process-"));
  try {
    const cli = join(directory, "fake-maestri");
    const pendingFile = join(directory, "pending.json");
    await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const [command,...args]=process.argv.slice(2);
const pendingFile=${JSON.stringify(pendingFile)};
if(command==='list') console.log(${JSON.stringify(listing)});
else if(command==='ask') {
  if(args.length!==2 || args.includes('--raw')) process.exit(2);
  const [,taskId,stage]=args[1].match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/);
  const [,file]=args[1].match(/Write a JSON result file at (.+) with taskId equal to/);
  fs.writeFileSync(pendingFile,JSON.stringify({taskId,stage,file}));
  console.log('accepted');
} else if(command==='check' && !fs.existsSync(pendingFile)) {
  const model=args[0]==='Hermes'?'GPT-6-Astra':'GPT-6.1-Sol';
  console.log(model+' default · ~/Developer/migration-maestro · idle');
} else if(command==='check') {
  const {taskId,stage,file}=JSON.parse(fs.readFileSync(pendingFile,'utf8'));
  if(stage==='IMPLEMENT') fs.writeFileSync(path.join(path.dirname(file),'index.html'),${JSON.stringify(html)});
  const artifact=stage+'.evidence.json', bytes=JSON.stringify({findings:['synthetic process fixture']});
  fs.writeFileSync(path.join(path.dirname(file),artifact),bytes);
  const digest=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(file,JSON.stringify({version:2,jobId:${JSON.stringify(id)},taskId,stage,status:'completed',summary:'subprocess result',evidence:['synthetic process fixture'],artifacts:[{file:artifact,digest}]}));
  console.log('completed');
} else process.exit(3);
`, { mode: 0o700 });
    const result = await runCentralDemo({ directory, id, transport: maestriTransport(cli, 3000), catalog, pollMs: 0 });
    assert.equal(result.state, "awaiting-review");
    assert.equal(result.completed.length, 6);
    assert.equal((result.outputs.review as { publishingAuthorized: boolean }).publishingAuthorized, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("CLI integration preserves official arguments, bounds failures and timeouts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-cli-"));
  try {
    const cli = join(directory, "fake-maestri");
    await writeFile(cli, `#!/usr/bin/env node
const [cmd,...args]=process.argv.slice(2);
if(cmd==='list') console.log('connected');
else if(args[0]==='slow') setTimeout(()=>{},10000);
else if(args[0]==='fail') process.exit(1);
else console.log(JSON.stringify({cmd,args}));
`, { mode: 0o700 });
    const transport = maestriTransport(cli, 3000);
    assert.equal((await transport("list", [])).trim(), "connected");
    const sent = JSON.parse(await transport("ask", ["Analytics", "literal $(no-shell)\nsecond line"]));
    assert.deepEqual(sent, { cmd: "ask", args: ["Analytics", "literal $(no-shell)\nsecond line"] });
    assert.equal(JSON.parse(await transport("check", ["Analytics"])).cmd, "check");
    await assert.rejects(transport("check", ["fail"]), /COMMAND_FAILED/);
    await assert.rejects(transport("check", ["slow"]), /TIMEOUT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing or changed route after dispatch blocks recovery without another ask", async () => {
  for (const mutation of ["missing", "changed"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "central-route-integrity-"));
    try {
      const calls: string[] = [];
      const opts = { directory, id, transport: responder(directory, calls, "ANALYZE"), catalog, maxPolls: 1, pollMs: 0 };
      await assert.rejects(runCentralDemo(opts), /analyze/);
      const file = join(directory, id, "ANALYZE.route.json");
      if (mutation === "missing") await rm(file);
      else {
        const route = JSON.parse(await readFile(file, "utf8"));
        route.selected.agentId = "Hermes";
        await writeFile(file, JSON.stringify(route));
      }
      const count = calls.filter(c => c.startsWith("ask:")).length;
      await assert.rejects(runCentralDemo(opts), /analyze/);
      assert.equal(calls.filter(c => c.startsWith("ask:")).length, count);
      const events = await readFile(join(directory, id, "events.jsonl"), "utf8");
      assert.match(events, /DISPATCH_ROUTE_(?:MISMATCH|RECONCILIATION_REQUIRED)/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("fallback dispatch stays pinned when preferred session returns and consumes a late result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "central-fallback-resume-"));
  try {
    const calls: string[] = [];
    let recovering = false;
    const base = responder(directory, calls, "ANALYZE");
    const transport: MaestriTransport = async (command, args) => {
      if (command === "list") return listing.replace("Connected portals:", '  - name: "Analytics alternate"\nConnected portals:');
      if (command === "check" && args[0] === "Analytics alternate" && !calls.some(c => c.startsWith("ask:"))) return "GPT-6.1-Sol default · idle";
      if (command === "check" && args[0] === "Analytics" && !recovering) return "unavailable";
      return base(command, args);
    };
    const opts = { directory, id, transport, catalog, maxPolls: 1, pollMs: 0 };
    await assert.rejects(runCentralDemo(opts), /analyze/);
    const receipt = JSON.parse(await readFile(join(directory, id, "ANALYZE.task.json"), "utf8"));
    assert.notEqual(receipt.agentId, "Analytics");
    const originalAgent = receipt.agentId;
    recovering = true;
    await writeResult(join(directory, id), receipt.taskId, "ANALYZE");
    const resumed: string[] = [];
    await runCentralDemo({ ...opts, transport: responder(directory, resumed) });
    const report = JSON.parse(await readFile(join(directory, id, "ANALYZE.reconciliation.json"), "utf8"));
    assert.equal(report.agentId, originalAgent);
    assert.equal(report.action, "result-collected");
    assert.deepEqual(report.route, {
      agentId: originalAgent, provider: "codex", modelId: "gpt-6.1-sol", profile: "ECONOMY", modelProfile: "BALANCED",
    });
    assert.equal(report.routeDigest, receipt.routeDigest);
    assert.equal(report.routeIntegrity, "receipt-digest-verified");
    assert.equal(report.routePinned, true);
    assert.equal(report.providerSwitchAuthorized, false);
    assert.equal(report.resendAuthorized, false);
    assert.equal(resumed.filter(c => c.startsWith("ask:")).length, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("lost dispatch receipt cannot trigger a new task even when the route is also lost", async () => {
  for (const removeRoute of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), "central-lost-receipt-"));
    try {
      const calls: string[] = [];
      const opts = { directory, id, transport: responder(directory, calls, "ANALYZE"), catalog, maxPolls: 1, pollMs: 0 };
      await assert.rejects(runCentralDemo(opts), /analyze/);
      await rm(join(directory, id, "ANALYZE.task.json"));
      if (removeRoute) await rm(join(directory, id, "ANALYZE.route.json"));
      await assert.rejects(runCentralDemo(opts), /analyze/);
      assert.equal(calls.filter(c => c.startsWith("ask:")).length, 1);
      assert.match(await readFile(join(directory, id, "events.jsonl"), "utf8"), /DISPATCH_RECEIPT_RECONCILIATION_REQUIRED/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("deferred dispatch is claimed once by an authorized executor and resumes with original task", async () => {
  const { executePendingDispatch } = await import("../src/autopilot/dispatch-executor.js");
  const directory = await mkdtemp(join(tmpdir(), "central-deferred-"));
  try {
    const calls: string[] = [];
    const opts = { directory, id, transport: responder(directory, calls), catalog, maxPolls: 1, pollMs: 0 };
    await assert.rejects(runCentralDemo({ ...opts, executor: "deferred" }), /analyze/);
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 0);
    const root = join(directory, id);
    const original = JSON.parse(await readFile(join(root, "ANALYZE.task.json"), "utf8"));
    // A result without an executor claim cannot complete a newly queued task.
    await writeFile(join(root, "ANALYZE.result.json"), JSON.stringify({ taskId: original.taskId, stage: "ANALYZE", status: "completed", summary: "unclaimed fixture", evidence: ["not execution proof"] }));
    await assert.rejects(runCentralDemo({ ...opts, executor: "deferred" }), /analyze/);
    await rm(join(root, "ANALYZE.result.json"));
    let sends = 0;
    const executor = {
      identity: { executorId: "test-executor", terminalId: "authorized-terminal", sessionId: "executor-session" },
      execute: async (request: { taskId: string; stage: string }) => {
        sends++;
        await writeResult(root, request.taskId, request.stage);
        throw Error("ambiguous timeout");
      },
    };
    const claims = await Promise.allSettled([executePendingDispatch(root, "ANALYZE", executor), executePendingDispatch(root, "ANALYZE", executor)]);
    assert.equal(claims.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(sends, 1);
    const receipt = JSON.parse(await readFile(join(root, "ANALYZE.dispatch-receipt.json"), "utf8"));
    assert.equal(receipt.outcome, "unknown");
    assert.equal(receipt.deliveryVerified, false);
    assert.equal(receipt.identity.sessionId, "executor-session");
    const resumed = await runCentralDemo(opts);
    assert.equal((resumed.outputs.analyze as { result: { taskId: string } }).result.taskId, original.taskId);
    assert.equal(calls.filter(c => c.startsWith("ask:")).length, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("completed checkpoints verify dispatch binding and executor receipt on reuse", async () => {
  for (const suffix of [".task.json", ".dispatch.json", ".dispatch-receipt.json"]) {
    const directory = await mkdtemp(join(tmpdir(), "central-cached-dispatch-"));
    try {
      const calls: string[] = [];
      const opts = { directory, id, transport: responder(directory, calls), catalog, pollMs: 0 };
      await runCentralDemo(opts);
      const file = join(directory, id, "ANALYZE" + suffix);
      const record = JSON.parse(await readFile(file, "utf8"));
      if (suffix === ".dispatch-receipt.json") record.attemptDigest = "0".repeat(64);
      else record.taskId = "0".repeat(36);
      await writeFile(file, JSON.stringify(record));
      const sends = calls.filter(c => c.startsWith("ask:")).length;
      await assert.rejects(runCentralDemo(opts), /DISPATCH_PROVENANCE_MISMATCH/);
      assert.equal(calls.filter(c => c.startsWith("ask:")).length, sends);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
