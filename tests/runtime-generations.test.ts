import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { initializeNativeService, type NativeServiceConfig } from '../src/agent-runtime/native/service.js';
import { canonical } from '../src/agent-runtime/contracts.js';
import { RuntimeGenerationManager, assertDrained, assertTransition, detachedSessions,
  transitions, type DrainReport, type Approval } from '../src/agent-runtime/generations/manager.js';
import { NativeAdmissionFence } from '../src/agent-runtime/native/admission.js';
import { inventory } from '../src/agent-runtime/generations/storage.js';

async function fixture(t:any){
  const dir=await realpath(await mkdtemp(join(tmpdir(),'generation-')));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const installation=join(dir,'installation');
  await mkdir(installation,{mode:0o700});
  const executable=join(dir,'codex');
  await writeFile(executable,'#!/bin/sh\nprintf "codex-cli 0.170.0\\n"\n',{mode:0o700});
  const config:NativeServiceConfig={version:1,stateDirectory:join(installation,'state'),
    socketPath:join(installation,'state','runtime.sock'),workspaceId:'fixture',
    providers:[{id:'codex-local',provider:'codex',executable,roles:[{agentId:'Analytics',modelId:'gpt-6-luna'}]}]};
  await initializeNativeService(config);
  await mkdir(join(config.stateDirectory,'codex-local'),{mode:0o700});
  await writeFile(join(config.stateDirectory,'codex-local','task.claim.json'),'historical claim');
  const path=join(installation,'runtime.json');await writeFile(path,JSON.stringify(config));
  const operator=generateKeyPairSync('ed25519');
  const manager=new RuntimeGenerationManager(join(dir,'manager'));
  await manager.initialize(path,operator.publicKey.export({format:'pem',type:'spki'}).toString());
  const sdkRoot=join(dir,'sdk');
  const pkg=join(sdkRoot,'node_modules','@anthropic-ai','claude-agent-sdk');
  await mkdir(pkg,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-agent-sdk',
    version:'0.3.329',claudeCodeVersion:'2.1.329',type:'module',exports:'./sdk.mjs'}));
  await writeFile(join(pkg,'sdk.mjs'),"throw Error('SDK must not be imported');");
  const candidate:NativeServiceConfig={...config,providers:[...config.providers,
    {id:'claude-local',provider:'claude-code',sdkRoot,roles:[{agentId:'Validator',modelId:'claude-sonnet-5-5'}]}]};
  const privateKey=createPrivateKey(await readFile(join(config.stateDirectory,'signing-key.pem')));
  const approval=(event:any,action:Approval['action'],patch:Partial<Approval>={})=>{
    const payload:Approval={version:1,action,sequence:event.sequence,generation:event.generation,
      manifestDigest:event.manifestDigest,approvedBy:'test operator',expiresAt:new Date(Date.now()+60000).toISOString(),...patch};
    return {payload,signature:sign(null,Buffer.from(canonical(payload)),operator.privateKey).toString('base64')};
  };
  const report=(event:any,patch:Partial<DrainReport>={})=>{
    const payload:DrainReport={version:1,sequence:event.sequence,generation:event.generation,
      manifestDigest:event.manifestDigest,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+50000).toISOString(),
      admissionClosed:true,runtimeStopped:true,inFlight:0,pendingClaims:0,ambiguousDeliveries:0,
      evidenceDigest:'a'.repeat(64),sessions:[{sessionId:'existing',ownership:'managed-detached',available:false,safeToClose:true}],...patch};
    return {payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString('base64')};
  };
  const fence=await NativeAdmissionFence.open(join(dir,'fence'),(await manager.runtimeEndpoint()).moduleDigest);
  return {dir,manager,config,candidate,path,approval,report,executable,fence};
}
test('explicit transition matrix rejects every unlisted transition',()=>{
  for(const from of Object.keys(transitions) as (keyof typeof transitions)[])
    for(const to of Object.keys(transitions) as (keyof typeof transitions)[]){
      if(transitions[from].includes(to))assert.doesNotThrow(()=>assertTransition(from,to));
      else assert.throws(()=>assertTransition(from,to),/TRANSITION_INVALID/);
    }
});
test('isolated candidate preserves installation, key, journals and Codex; access remains unverified',async t=>{
  const f=await fixture(t),before=await inventory(join(f.dir,'installation'));
  const event=await f.manager.prepare(f.candidate,0);
  assert.equal(event.state,'UPDATE_PREPARED');
  const record=JSON.parse(await readFile(join(f.manager.root,'candidates',event.generation!,'manifest.json'),'utf8'));
  assert.equal(record.payload.access,'unverified');
  assert.equal(record.payload.drivers.length,2);
  assert.deepEqual(record.payload.config.providers[0],f.config.providers[0]);
  assert.deepEqual(await inventory(join(f.dir,'installation')),before);
});
test('concurrent preparations use exclusive sequence CAS; retain losing candidate evidence',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled([f.manager.prepare(f.candidate,0),f.manager.prepare(f.candidate,0)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await f.manager.history()).length,2);
  assert.equal((await readdir(join(f.manager.root,'candidates'))).length,2);
});
test('drain approval binds candidate, actor, signature and sequence; never stops live session',async t=>{
  const f=await fixture(t),event=await f.manager.prepare(f.candidate,0);
  const bad=f.approval(event,'DRAIN');bad.payload.approvedBy='tampered';
  await assert.rejects(f.manager.requestDrain(1,bad,f.fence),/SIGNATURE_INVALID/);
  const draining=await f.manager.requestDrain(1,f.approval(event,'DRAIN'),f.fence);
  assert.equal(draining.state,'DRAINING');
  await assert.rejects(f.manager.requestDrain(1,f.approval(event,'DRAIN'),f.fence),/STALE_SEQUENCE/);
  for(const patch of [{inFlight:1},{pendingClaims:1},{ambiguousDeliveries:1},{admissionClosed:false},{runtimeStopped:false},
    {sessions:[{sessionId:'live',ownership:'managed' as const,available:true,safeToClose:false}]}])
    await assert.rejects(f.manager.markReady(2,f.report(draining,patch),f.fence),/DRAIN_BLOCKED/);
  assert.equal((await f.manager.status()).state,'DRAINING');
});
test('ready stores detached identity and replacement authorization; real activation fails closed',async t=>{
  const f=await fixture(t),prepared=await f.manager.prepare(f.candidate,0);
  const draining=await f.manager.requestDrain(1,f.approval(prepared,'DRAIN'),f.fence);
  const ready=await f.manager.markReady(2,f.report(draining),f.fence);
  assert.equal(ready.state,'READY_TO_ACTIVATE');
  assert.deepEqual(detachedSessions(f.report(draining).payload.sessions),[
    {sessionId:'existing',ownership:'managed-detached',available:false,replacementAuthorizationRequired:true}]);
  await assert.rejects(f.manager.activate(3),/FENCED_LOADER_NOT_IMPLEMENTED/);
  assert.equal((await f.manager.status()).state,'READY_TO_ACTIVATE');
});
test('recovery after interrupted drain requires rollback; cancellation retains immutable evidence',async t=>{
  const f=await fixture(t),before=await inventory(join(f.dir,'installation'));
  const p=await f.manager.prepare(f.candidate,0);
  await f.manager.requestDrain(1,f.approval(p,'DRAIN'),f.fence);
  const restarted=new RuntimeGenerationManager(f.manager.root);
  const r=await restarted.recover(2);assert.equal(r.state,'ROLLBACK_REQUIRED');
  const active=await restarted.rollback(3,f.approval(r,'ROLLBACK'));
  assert.equal(active.state,'ACTIVE');
  assert.equal((await readdir(join(f.manager.root,'candidates'))).length,1);
  assert.equal((await restarted.history()).length,5);
  assert.deepEqual(await inventory(join(f.dir,'installation')),before);
});
test('partial publication is ignored; committed preparation recovers idempotently',async t=>{
  const f=await fixture(t),prepared=await f.manager.prepare(f.candidate,0);
  await writeFile(join(f.manager.root,'events','.pending-interrupted'),'partial');
  const restarted=new RuntimeGenerationManager(f.manager.root);
  assert.deepEqual(await restarted.recover(1),prepared);
  assert.deepEqual(await restarted.recover(1),prepared);
});
test('manifest corruption is detected on recovery, retained, and can only cancel offline candidate',async t=>{
  const f=await fixture(t),p=await f.manager.prepare(f.candidate,0);
  const path=join(f.manager.root,'candidates',p.generation!,'manifest.json');
  await writeFile(path,'{}');
  const r=await f.manager.recover(1);assert.equal(r.state,'ROLLBACK_REQUIRED');
  await f.manager.rollback(2,f.approval(r,'ROLLBACK'));
  assert.equal(await readFile(path,'utf8'),'{}');
});
test('driver modification invalidates a prepared candidate',async t=>{
  const f=await fixture(t),p=await f.manager.prepare(f.candidate,0);
  await writeFile(f.executable,'changed');
  await assert.rejects(f.manager.requestDrain(1,f.approval(p,'DRAIN'),f.fence),/PRESERVED_FILE_CHANGED/);
});
test('journal additions and config changes block preparation/rollback instead of overwriting evidence',async t=>{
  const f=await fixture(t),p=await f.manager.prepare(f.candidate,0);
  await writeFile(join(f.config.stateDirectory,'new-receipt.json'),'ambiguous');
  const r=await f.manager.recover(1);assert.equal(r.state,'ROLLBACK_REQUIRED');
  await assert.rejects(f.manager.rollback(2,f.approval(r,'ROLLBACK')),/JOURNAL_SET_CHANGED/);
  assert.equal(await readFile(join(f.config.stateDirectory,'new-receipt.json'),'utf8'),'ambiguous');
  await writeFile(f.path,JSON.stringify({...f.config,workspaceId:'changed'}));
  await assert.rejects(f.manager.rollback(2,f.approval(r,'ROLLBACK')),/BASE_CHANGED/);
});
test('unsupported driver version and modified Analytics configuration fail before accepting candidate',async t=>{
  const f=await fixture(t);
  const changed=structuredClone(f.candidate);changed.providers[0].roles[0].modelId='other';
  await assert.rejects(f.manager.prepare(changed,0),/EXISTING_CONFIGURATION_CHANGED/);
  await writeFile(f.executable,'#!/bin/sh\nprintf "codex-cli 0.999.0\\n"\n');
  await assert.rejects(f.manager.prepare(f.candidate,0),/VERSION_UNREVIEWED/);
  assert.equal((await f.manager.status()).state,'ACTIVE');
});
test('expired drain report and unsafe detached session remain blocked',()=>{
  const common:DrainReport={version:1,generation:'fixture',manifestDigest:'a'.repeat(64),sequence:2,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()-1).toISOString(),
    admissionClosed:true,runtimeStopped:true,inFlight:0,pendingClaims:0,ambiguousDeliveries:0,
    evidenceDigest:'b'.repeat(64),sessions:[]};
  assert.throws(()=>assertDrained(common),/EVIDENCE_INVALID/);
  assert.throws(()=>assertDrained({...common,expiresAt:new Date(Date.now()+30000).toISOString(),
    sessions:[{sessionId:'detached',ownership:'managed-detached',available:false,safeToClose:false}]}),/DRAIN_BLOCKED/);
});
test('event tampering and nonisolated storage fail closed',async t=>{
  const f=await fixture(t);
  const event=join(f.manager.root,'events','00000000.json');
  await writeFile(event,'{}');
  await assert.rejects(f.manager.status(),/INTEGRITY_FAILED/);
  const manager=new RuntimeGenerationManager(join(f.config.stateDirectory,'manager'));
  const key=generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString();
  await assert.rejects(manager.initialize(f.path,key),/STORAGE_MUST_BE_ISOLATED/);
});
test('expired/replayed approvals and substituted drain signatures are rejected',async t=>{
  const f=await fixture(t),p=await f.manager.prepare(f.candidate,0);
  const expired=f.approval(p,'DRAIN',{expiresAt:new Date(0).toISOString()});
  await assert.rejects(f.manager.requestDrain(1,expired,f.fence),/APPROVAL_INVALID/);
  await assert.rejects(f.manager.requestDrain(1,f.approval({...p,manifestDigest:'0'.repeat(64)},'DRAIN'),f.fence),/APPROVAL_INVALID/);
  const d=await f.manager.requestDrain(1,f.approval(p,'DRAIN'),f.fence);
  const report=f.report(d);report.payload.pendingClaims=9;
  await assert.rejects(f.manager.markReady(2,report,f.fence),/SIGNATURE_INVALID/);
  await assert.rejects(f.manager.markReady(2,f.report({...d,sequence:99}),f.fence),/DRAIN_BINDING_INVALID/);
});
test('Claude version must be reviewed and its files remain pinned after preparation',async t=>{
  const f=await fixture(t);
  const pkg=join(f.dir,'sdk','node_modules','@anthropic-ai','claude-agent-sdk','package.json');
  const old=await readFile(pkg,'utf8');
  await writeFile(pkg,old.replace('0.3.329','0.4.0'));
  await assert.rejects(f.manager.prepare(f.candidate,0),/CLAUDE_VERSION_UNREVIEWED/);
  await writeFile(pkg,old);
  const p=await f.manager.prepare(f.candidate,0);
  await writeFile(join(f.dir,'sdk','node_modules','@anthropic-ai','claude-agent-sdk','new-code.mjs'),'added');
  await assert.rejects(f.manager.requestDrain(1,f.approval(p,'DRAIN'),f.fence),/DRIVER_CHANGED/);
});
test('missing event is not repaired or renumbered on recovery',async t=>{
  const f=await fixture(t);
  await f.manager.prepare(f.candidate,0);
  await rm(join(f.manager.root,'events','00000000.json'));
  await assert.rejects(f.manager.recover(1),/HISTORY_GAP/);
});
test('symlinked manager parent is rejected before touching the active installation',async t=>{
  const f=await fixture(t),before=await inventory(join(f.dir,'installation'));
  await symlink(f.config.stateDirectory,join(f.dir,'alias'));
  const manager=new RuntimeGenerationManager(join(f.dir,'alias','unsafe'));
  const key=generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}).toString();
  await assert.rejects(manager.initialize(f.path,key),/PRIVATE_DIRECTORY_REQUIRED/);
  assert.deepEqual(await inventory(join(f.dir,'installation')),before);
});
test('manager drain requires the live installation fence and closes it before committing DRAINING',async t=>{
  const f=await fixture(t),p=await f.manager.prepare(f.candidate,0);
  await assert.rejects(f.manager.requestDrain(1,f.approval(p,'DRAIN')),/LIVE_FENCE_REQUIRED/);
  const wrong=await NativeAdmissionFence.open(join(f.dir,'wrong-fence'),'0'.repeat(64));
  await assert.rejects(f.manager.requestDrain(1,f.approval(p,'DRAIN'),wrong),/RUNTIME_BINDING_INVALID/);
  let release!:()=>void,started!:()=>void;
  const work=new Promise<void>(r=>{release=r;}),begun=new Promise<void>(r=>{started=r;});
  const operation=f.fence.execute('send',{providerId:'codex-local',taskId:'fixture'},async()=>{started();await work;return {accepted:true};});
  await begun;
  const d=await f.manager.requestDrain(1,f.approval(p,'DRAIN'),f.fence);
  assert.equal(d.state,'DRAINING');assert.equal(f.fence.draining,true);
  await assert.rejects(f.manager.markReady(2,f.report(d),f.fence),/FENCE_NOT_DRAINED/);
  release();await operation;
  await assert.rejects(f.manager.markReady(2,f.report(d),f.fence),/FENCE_NOT_DRAINED/);
  await assert.rejects(f.fence.execute('prepare',{providerId:'codex-local'},async()=>{}),/ADMISSION_CLOSED/);
});
