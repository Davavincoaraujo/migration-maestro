import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { diagnoseMaestri } from '../src/integrations/maestri-diagnostic.js';
import { MaestriCommandError } from '../src/integrations/maestri-central-cli.js';
import { validateOperationalPolicy } from '../src/ai/operational-routing.js';
import { snapshotOperational } from '../src/autopilot/operational-reconcile.js';
const policy=validateOperationalPolicy({version:1,scope:'isolated-synthetic',maxRisk:'MEDIUM',agents:[
  {agentId:'Hermes',mode:'declared',provider:'codex',modelId:'gpt-6-astra',capabilities:['planning','coding']}]});
const list='Connected agents:\n - name: "Hermes"\nConnected portals:';
function blocked(r:Awaited<ReturnType<typeof diagnoseMaestri>>) {
  assert.equal(r.authorizationGranted,false);assert.equal(r.pipelineAdvanceAuthorized,false);assert.equal(r.plan.status,'blocked');
  assert.equal(r.dispatchBinding.sessionBound,false);
  for(const a of r.agents) {
    assert.equal(a.sessionIdentity.verified,false);assert.equal(a.sessionIdentity.sessionId,null);
    assert.equal(a.activeModel.verified,false);assert.equal(a.profile.verified,false);
    assert.equal(a.capabilities.verified,false);assert.equal(a.availability.verified,false);
    assert.equal(a.attestation.status,'unverified');assert.equal(a.continuity.verified,false);
  }
}
test('permission denied is IPC failure, not proof of agent unavailability; no retry or prompts',async()=>{
  const calls:string[]=[];
  const r=await diagnoseMaestri({policy,transport:async c=>{calls.push(c);throw new MaestriCommandError('list',1,'permission-denied','MAESTRI_COMMAND_FAILED');}});
  assert.equal(r.ipc.state,'unavailable');assert.equal(r.ipc.commandRoundTripVerified,false);
  assert.equal(r.samples[0].ipc.diagnostic,'IPC_PERMISSION_DENIED');assert.deepEqual(calls,['list']);blocked(r);
});
test('successful list verifies only command round trip; session/model/capacity stay unknown',async()=>{
  const calls:string[]=[];const r=await diagnoseMaestri({policy,transport:async c=>{calls.push(c);return list;}});
  assert.equal(r.ipc.state,'reachable');assert.equal(r.ipc.commandRoundTripVerified,true);
  assert.equal(r.samples[0].agents[0].nameObservation,'observed');
  assert.equal(r.agents[0].declared.modelId,'gpt-6-astra');assert.equal(r.agents[0].requiredProfile,'ADVANCED');
  assert.equal(r.agents[0].continuity.diagnostic,'UNCHANGED_OBSERVATIONS_DO_NOT_PROVE_SESSION_CONTINUITY');
  assert.deepEqual(calls,['list','list']);blocked(r);
});
test('optional footer observation never authenticates model, profile or capability; no raw screen leaks',async()=>{
  const r=await diagnoseMaestri({policy,observeModel:true,transport:async c=>c==='list'?list:'PRIVATE CONVERSATION\nGPT-6-astra high · /private/path'});
  assert.equal(r.samples[0].agents[0].modelObservation.visibleModel,'GPT-6-astra');
  assert.equal(r.samples[0].agents[0].modelObservation.state,'observed-not-authenticated');
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE CONVERSATION|private\/path/);blocked(r);
});
test('unrecognized model remains unknown despite a declared model',async()=>{
  const r=await diagnoseMaestri({policy,observeModel:true,transport:async c=>c==='list'?list:'no model metadata'});
  assert.equal(r.samples[0].agents[0].modelObservation.diagnostic,'MODEL_NOT_EXPOSED');blocked(r);
});
test('simulated session switch with unchanged agent name cannot be certified stable',async()=>{
  let n=0;const r=await diagnoseMaestri({policy,transport:async()=>list+'\nsessionId: '+(++n===1?'session-A':'session-B')});
  assert.equal(r.agents[0].continuity.responseChanged,true);
  assert.equal(r.agents[0].continuity.diagnostic,'OBSERVATIONS_CHANGED_SESSION_SWITCH_POSSIBLE');
  assert.doesNotMatch(JSON.stringify(r),/session-A|session-B/);blocked(r);
});
test('model change is a warning observation, never a confirmed session change',async()=>{
  let n=0;const r=await diagnoseMaestri({policy,observeModel:true,transport:async c=>c==='list'?list:(++n===1?'GPT-6-astra high · local':'GPT-6.1-sol high · local')});
  assert.equal(r.agents[0].continuity.modelObservationChanged,true);blocked(r);
});
test('inconsistent reply, duplicate name and missing name prevent check',async()=>{
  for(const raw of ['{"sessionId":"fake","verified":true}', 'Connected agents:\nname: "Hermes"\nname: "Hermes"', 'Connected agents:\nname: "Other"','Connected agents:\nname: "Hermes"\nname: malformed']) {
    const calls:string[]=[];const r=await diagnoseMaestri({policy,observeModel:true,transport:async c=>{calls.push(c);return raw;}});
    assert.deepEqual(calls,['list','list']);blocked(r);
    if(raw.startsWith('{')||raw.includes('malformed'))assert.equal(r.samples[0].ipc.diagnostic,'LIST_RESPONSE_INCONSISTENT');
  }
});
test('second list failure and failed check remain diagnostic and redact errors',async()=>{
  let n=0;const r=await diagnoseMaestri({policy,transport:async()=>{if(n++)throw Error('SECRET ERROR');return list;}});
  assert.equal(r.ipc.state,'intermittent');assert.equal(r.agents[0].continuity.responseChanged,null);blocked(r);
  const checked=await diagnoseMaestri({policy,observeModel:true,transport:async c=>{if(c==='list')return list;throw Error('SECRET ERROR');}});
  assert.equal(checked.samples[0].agents[0].modelObservation.diagnostic,'MODEL_CHECK_FAILED');
  assert.doesNotMatch(JSON.stringify([r,checked]),/SECRET ERROR/);blocked(checked);
});
test('CLI diagnosis preserves all job bytes and needs no authorization; invalid args never invoke transport',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'diagnose-cli-')),id='a'.repeat(20);
  try {
    const root=join(cwd,'.local-maestro','operations',id);await mkdir(root,{recursive:true});
    await writeFile(join(root,'operation.json'),JSON.stringify({policy}));
    await writeFile(join(root,'historical-receipt.json'),'{"outcome":"unknown"}');
    const fake=join(cwd,'maestri');
    await writeFile(fake,'#!/bin/sh\ncase "$1" in\nlist) printf \'Connected agents:\\nname: "Hermes"\\n\';;\ncheck) printf \'GPT-6-astra high · test\\n\';;\n*) exit 98;;\nesac\n',{mode:0o700});
    const before=await snapshotOperational(root);
    const run=(args:string[])=>execFileSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli-operational.ts'),...args],
      {cwd,env:{...process.env,MAESTRI_CLI:fake,MAESTRI_TERMINAL_ID:'PRIVATE_ENV_ID'},encoding:'utf8',stdio:'pipe'});
    const report=JSON.parse(run(['diagnose-maestri',id,'--observe-model']));blocked(report);
    assert.doesNotMatch(JSON.stringify(report),/PRIVATE_ENV_ID/);assert.deepEqual(await snapshotOperational(root),before);
    assert.throws(()=>run(['diagnose-maestri',id,'--approve-continuation']));
    assert.throws(()=>run(['diagnose-maestri','../unsafe']));
    assert.throws(()=>run(['diagnose-maestri',id,'--observe-model','--observe-model']));
    assert.deepEqual(await snapshotOperational(root),before);
    assert.equal(await readFile(join(root,'historical-receipt.json'),'utf8'),'{"outcome":"unknown"}');
  }finally{await rm(cwd,{recursive:true,force:true});}
});
