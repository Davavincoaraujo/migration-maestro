// Local audit only: never invokes Maestri or approves a delivery.
// Run: node --import tsx scripts/operational-acceptance.mjs
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { runOperational } from '../src/autopilot/operational-run.ts';
import { verifyDispatch, dispatchDigest } from '../src/autopilot/dispatch-executor.ts';
import { syntheticOperationalAgent } from '../tests/fixtures/operational-agent.ts';
const id = '4f07b36eae3079cd0131';
const base = resolve('.local-maestro/operations'), root = join(base, id);
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function manifest(dir, prefix = '') {
  const result = {};
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), 'Symlink in evidence');
    if (entry.isDirectory()) Object.assign(result, await manifest(join(dir,entry.name),name+'/'));
    else result[name] = hash(await readFile(join(dir,entry.name)));
  }
  return result;
}
const before = await manifest(root), operation = await json(join(root,'operation.json'));
const checkpoint = await json(join(root,id+'.checkpoint.json'));
assert.equal(operation.executionMode,'real');
assert.deepEqual(checkpoint.completed,['analyze','review']);
assert.equal(checkpoint.state,'awaiting-review');
const out = checkpoint.outputs.analyze;
const task = await json(join(root,'ANALYZE.task.json'));
assert.equal(dispatchDigest((await json(join(root,'ANALYZE.route.json'))).selected), task.routeDigest);
await verifyDispatch(root,'ANALYZE',task);
for (const key of ['taskId','agentId','routeDigest','requestDigest']) assert.equal(out.dispatch[key], task[key]);
assert.equal(before['ANALYZE.result.json'],out.resultDigest);
assert.deepEqual(await json(join(root,'ANALYZE.result.json')),out.result);
for (const a of out.artifacts) assert.equal(before[a.file],a.digest);
const inventory = await json(join(root,'inventory.json'));
assert.deepEqual(inventory,{version:1,componentCount:2,resourceTypes:['demo/components/hero','demo/components/text'],missingResourceTypeIds:['broken']});
const evidenceDir = resolve('local-output','operational-acceptance-'+randomBytes(6).toString('hex'));
await mkdir(evidenceDir,{recursive:true});
await cp(root,join(evidenceDir,'original-backup'),{recursive:true,errorOnExist:true,force:false});
// Checkpoint input includes its absolute root: replay in place, with all transport denied.
// Explicit real preserves the historical execution label; this audit is not a new real execution.
let transportCalls = 0;
const offline = async () => { transportCalls++; throw Error('AUDIT_TRANSPORT_FORBIDDEN'); };
const resumed = await runOperational({directory:base,id,kind:operation.kind,policy:operation.policy,confirmed:true,transport:offline,executionMode:operation.executionMode,pollMs:0});
assert.equal(resumed.status,'awaiting-approval');
assert.equal(transportCalls,0);
assert.deepEqual(await manifest(root),before,'Original job bytes must remain unchanged');
const calls = [], simulationId = randomBytes(10).toString('hex');
const options = {directory:join(evidenceDir,'simulation'),id:simulationId,kind:'pipeline',policy:await json('config/operational-agents.json'),confirmed:true,transport:syntheticOperationalAgent(calls),pollMs:0};
const planned = await runOperational({...options,pauseAfter:'PLAN'});
assert.deepEqual(planned.completed,['analyze','map-components','plan']);
const completed = await runOperational(options);
assert.equal(completed.status,'awaiting-approval');
assert.equal(completed.executionMode,'simulated');
assert.equal(completed.realAcceptanceVerified,false);
assert.deepEqual(completed.completed,['analyze','map-components','plan','implement','validate','review']);
const sendCount = calls.filter(c=>c.startsWith('ask:')).length;
assert.equal(sendCount,8);
await runOperational(options);
assert.equal(calls.filter(c=>c.startsWith('ask:')).length,sendCount);
const report = {auditedAt:new Date().toISOString(),jobId:id,originalFiles:before,originalBytesUnchanged:true,offlineResumeTransportCalls:transportCalls,originalStatus:resumed,simulation:{id:simulationId,status:completed,dispatches:sendCount,duplicateDispatches:0},limitations:['Local hashes and CLI receipts do not authenticate provider identity','Full pipeline tested with fixtures only','No human acceptance or external writes performed']};
await writeFile(join(evidenceDir,'audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({evidenceDir,originalStatus:resumed.status,transportCalls,simulationId,simulationStatus:completed.status,simulationDispatches:sendCount},null,2));
