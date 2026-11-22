import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { canonical, digest, bytesDigest } from '../src/agent-runtime/contracts.js';
import { envelope } from '../src/agent-runtime/generations/storage.js';
import { TransactionalGenerationLoader, type ActivationApproval } from '../src/agent-runtime/transactional-loader/loader.js';
import { NativeAdmissionFence } from '../src/agent-runtime/native/admission.js';
import { RuntimeEpochLease } from '../src/agent-runtime/transactional-loader/epoch.js';
import type { Manifest } from '../src/agent-runtime/generations/manager.js';
async function fixture(t:any,failpoint?:()=>void) {
 const root=await realpath(await mkdtemp(join(tmpdir(),'loader-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,'candidates');await mkdir(dir,{mode:0o700});
 const manifestPath=join(dir,'candidate.json'),config={version:1 as const,stateDirectory:join(root,'shared-state'),
  socketPath:join(root,'shared-state','runtime.sock'),workspaceId:'fixture',providers:[{id:'codex-local',provider:'codex' as const,
  executable:'/reviewed/codex',roles:[{agentId:'Analytics',modelId:'gpt-6-luna'}]}]};
 const manifest:Manifest={version:1,id:randomUUID(),baseDigest:'a'.repeat(64),config,implementation:'b'.repeat(64),
  drivers:[],access:'verified',accessEvidenceDigests:{'codex-local':'d'.repeat(64)},createdAt:new Date().toISOString(),
  adapters:{version:1,adapters:[{kind:'native-service',id:'codex-local',socketPath:config.socketPath,
    publicKey:'fixture-public-anchor',moduleDigest:digest({implementation:'b'.repeat(64),config})}]}};
 await envelope(manifestPath,manifest);
 const keys=generateKeyPairSync('ed25519'),loader=new TransactionalGenerationLoader(join(root,'loader'),failpoint);
 await mkdir(join(root,'shared-state'),{mode:0o700});
 const loaderRoot=join(root,'loader');await mkdir(loaderRoot,{mode:0o700});
 const baseline={version:1 as const,epoch:1,generationId:manifest.id,manifestPath,manifestDigest:digest(manifest),
   previousDigest:null,committedAt:new Date().toISOString()};
 await writeFile(join(loaderRoot,'active.json'),JSON.stringify(baseline),{mode:0o600});
 const fence=await NativeAdmissionFence.open(join(root,'admission'),'f'.repeat(64));
 const binding={generation:'candidate',manifestDigest:digest(manifest),sequence:1};
 await fence.closeForDrain(binding);await fence.confirmReady(binding,async()=>{});
 const lease=RuntimeEpochLease.bind(loader,baseline,fence);
 const payload={version:1 as const,generationId:manifest.id,manifestPath,manifestDigest:digest(manifest),sequence:1,
  action:'ACTIVATE' as const,expectedPointerDigest:digest(baseline),approvedBy:'reviewed operator',
  expiresAt:new Date(Date.now()+60000).toISOString()};
 const approval:ActivationApproval={payload,signature:sign(null,Buffer.from(canonical(payload)),keys.privateKey).toString('base64')};
 const auth=async(pointer:any)=>{assert.equal(pointer.manifestDigest,digest(manifest));};
 return {root,manifest,manifestPath,keys,loader,approval,fence,lease,auth,baseline};
}
test('loads only signed approval and digest verified manifest; atomic pointer fences stale processes',async t=>{
 const f=await fixture(t);
 const pointer=await f.loader.activate(f.approval,f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),1,f.lease,f.auth);
 assert.equal(pointer.epoch,2);await f.loader.assertCurrent(pointer);
 await assert.rejects(f.loader.assertCurrent({generationId:pointer.generationId,epoch:0,manifestDigest:pointer.manifestDigest}),/STALE_PROCESS_FENCED/);
 assert.equal((await f.loader.inspectRecovery()).transactions[0].classification,'COMMITTED');
});
test('refuses missing live fence, invalid signature, expiry, stale pointer and changed manifest',async t=>{
 const f=await fixture(t),pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 await assert.rejects(f.loader.activate(f.approval,pub,1),/LIVE_FENCED_CONSUMER_REQUIRED/);
 const invalid={...f.approval,signature:Buffer.alloc(64).toString('base64')};
 await assert.rejects(f.loader.activate(invalid,pub,1,f.lease,f.auth),/LOADER_APPROVAL_INVALID/);
 const changed={...f.approval,payload:{...f.approval.payload,expiresAt:new Date(0).toISOString()}};
 await assert.rejects(f.loader.activate(changed,pub,1,f.lease,f.auth),/APPROVAL_INVALID/);
 await writeFile(f.manifestPath,'{}');
 await assert.rejects(f.loader.activate(f.approval,pub,1,f.lease,f.auth),/MANIFEST_DIGEST_INVALID/);
});
test('crash before pointer rename preserves prior generation and leaves recoverable evidence',async t=>{
 const f=await fixture(t),pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 const first=await f.loader.activate(f.approval,pub,1,f.lease,f.auth);
 const secondManifest={...f.manifest,id:randomUUID()};
 const secondPath=join(f.root,'candidates','second.json');await envelope(secondPath,secondManifest);
 const payload={...f.approval.payload,generationId:secondManifest.id,manifestPath:secondPath,
  manifestDigest:digest(secondManifest),expectedPointerDigest:digest(first),sequence:2};
 const approval={payload,signature:sign(null,Buffer.from(canonical(payload)),f.keys.privateKey).toString('base64')};
 const crash=new TransactionalGenerationLoader(join(f.root,'loader'));
 await assert.rejects(crash.activate(approval,pub,2,RuntimeEpochLease.bind(f.loader,{generationId:(await f.loader.current())!.generationId,epoch:(await f.loader.current())!.epoch,manifestDigest:(await f.loader.current())!.manifestDigest},await readyFence(f)),async()=>{throw Error('simulated crash before swap');}),/simulated crash/);
 assert.deepEqual(await crash.current(),first);
 const state=await f.loader.inspectRecovery();assert.equal(state.recoveryRequired,true);
 assert.ok(state.transactions.some(tx=>tx.classification==='PREPARED_POINTER_UNCHANGED'));
 await assert.rejects(f.lease.run(async()=>{}),/LOADER_RECOVERY_REQUIRED/);
});
test('crash after atomic pointer rename is classified new-active, never rolls pointer back',async t=>{
 const f=await fixture(t,()=>{throw Error('simulated crash after pointer swap');});
 const pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 await assert.rejects(f.loader.activate(f.approval,pub,1,f.lease,f.auth),/simulated crash/);
 const pointer=await f.loader.current();assert.equal(pointer?.generationId,f.manifest.id);
 const state=await f.loader.inspectRecovery();
 assert.equal(state.transactions[0].classification,'POINTER_SWAPPED_AUDIT_INCOMPLETE');
 await assert.rejects(f.lease.run(async()=>{}),/LOADER_RECOVERY_REQUIRED/);
});
test('invalid active pointer blocks Native Runtime startup validation',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.root,'loader','active.json'),JSON.stringify({...f.baseline,epoch:0}));
 await assert.rejects(f.lease.validateStartup(),/LOADER_POINTER_INVALID/);
});
test('separate Node processes serialize epoch leases and stale token is rejected after swap',async t=>{
 const f=await fixture(t),log=join(f.root,'locks.jsonl'),worker=join(process.cwd(),'scripts/epoch-lock-worker.mjs');
 const run=()=>new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',worker,join(f.root,'loader'),log],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.setEncoding('utf8').on('data',x=>stderr+=x);
  child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
 });
 const results=await Promise.all([run(),run()]);
 assert.deepEqual(results.map(x=>x.code),[0,0]);
 const rows=(await readFile(log,'utf8')).trim().split('\n').map(x=>JSON.parse(x));
 assert.equal(rows.length,4);
 const intervals=[rows.filter(x=>x.phase==='start'),rows.filter(x=>x.phase==='end')];
 const [x,y]=intervals[0].sort((a,b)=>a.start-b.start),[xe,ye]=intervals[1].sort((a,b)=>a.end-b.end);
 assert.ok(xe.end<=y.start||ye.end<=x.start,'cross-process epoch locks overlapped');
 const pointer=await f.loader.activate(f.approval,f.keys.publicKey.export({format:'pem',type:'spki'}).toString(),1,f.lease,f.auth);
 await assert.rejects(f.lease.run(async()=>{}),/RUNTIME_EPOCH_STALE/);
 const stale=await new Promise<number|null>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',worker,join(f.root,'loader'),log,'assert-stale',
   f.baseline.generationId,String(f.baseline.epoch),f.baseline.manifestDigest],{stdio:['ignore','ignore','pipe']});
  child.on('error',reject);child.on('close',resolve);
 });
 assert.equal(stale,0,'a separate Node process must reject the superseded epoch');
 assert.equal(pointer.epoch,2);
});
test('activation waits for an in-flight process epoch lease before swapping',async t=>{
 const f=await fixture(t),pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const operation=f.lease.run(async()=>{entered();await gate;});
 await started;
 let activated=false;
 const activation=f.loader.activate(f.approval,pub,1,f.lease,f.auth).then(value=>{activated=true;return value;});
 await new Promise(r=>setTimeout(r,40));
 assert.equal(activated,false,'activation must wait while the prior process holds the epoch lease');
 release();await operation;
 const pointer=await activation;
 assert.equal(pointer.epoch,2);
});
test('each epoch lease revalidates active manifest and driver digests before external work',async t=>{
 const f=await fixture(t);
 await f.lease.run(async()=>{});
 await writeFile(f.manifestPath,'tampered');
 await assert.rejects(f.lease.run(async()=>{throw Error('external effect must not run');}),/LOADER_MANIFEST_DIGEST_INVALID/);
});
test('a crashed process leaves a persistent fail-closed epoch lock',async t=>{
 const f=await fixture(t),log=join(f.root,'crash.jsonl'),worker=join(process.cwd(),'scripts/epoch-lock-worker.mjs');
 const child=spawn(process.execPath,['--import','tsx',worker,join(f.root,'loader'),log,'crash'],{stdio:['ignore','ignore','pipe']});
 const exit=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(exit,77);
 await assert.rejects(f.loader.withEpochLock(async()=>{}),/RUNTIME_EPOCH_LOCKED_REVIEW_REQUIRED/);
 assert.equal((await f.loader.inspectRecovery()).recoveryRequired,true);
});
test('orphan lock recovery requires a signed operator authorization and preserves the lock evidence',async t=>{
 const f=await fixture(t),log=join(f.root,'orphan.jsonl'),worker=join(process.cwd(),'scripts/epoch-lock-worker.mjs');
 const child=spawn(process.execPath,['--import','tsx',worker,join(f.root,'loader'),log,'crash'],{stdio:['ignore','ignore','pipe']});
 await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 const owner=(await f.loader.inspectRecovery()).epochOwner!;
 const authorizationPayload={version:1 as const,lockName:'epoch.lock',ownerDigest:digest(owner),pid:owner.pid,
  host:owner.host,ownerId:owner.ownerId,approvedBy:'operator',expiresAt:new Date(Date.now()+60000).toISOString()};
 const publicKey=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 await assert.rejects(f.loader.recoverOrphanLock({payload:authorizationPayload,signature:'invalid'},publicKey),/AUTHORIZATION_INVALID/);
 assert.ok((await f.loader.inspectRecovery()).epochLockPresent);
 const authorization={payload:authorizationPayload,signature:sign(null,Buffer.from(canonical(authorizationPayload)),f.keys.privateKey).toString('base64')};
 const recovered=await f.loader.recoverOrphanLock(authorization,publicKey);
 assert.equal(recovered.recovered,true);
 assert.ok(await readFile(join(recovered.evidencePath,'owner.json')));
 assert.ok(await readFile(recovered.evidencePath+'.authorization.json'));
 await f.loader.withEpochLock(async()=>{});
});
test('a signed orphan-lock authorization cannot remove a lock owned by a live process',async t=>{
 const f=await fixture(t),publicKey=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 await f.loader.withEpochLock(async()=>{
  const owner=(await f.loader.inspectRecovery()).epochOwner!;
  const payload={version:1 as const,lockName:'epoch.lock',ownerDigest:digest(owner),pid:owner.pid,
   host:owner.host,ownerId:owner.ownerId,approvedBy:'operator',expiresAt:new Date(Date.now()+60000).toISOString()};
  const authorization={payload,signature:sign(null,Buffer.from(canonical(payload)),f.keys.privateKey).toString('base64')};
  await assert.rejects(f.loader.recoverOrphanLock(authorization,publicKey),/OWNER_STILL_ACTIVE/);
  assert.equal((await f.loader.inspectRecovery()).epochLockPresent,true);
 });
});
test('activation authorization callback runs under lock and may veto pointer swap',async t=>{
 const f=await fixture(t),pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 let readyChecks=0;
 await assert.rejects(f.loader.activate(f.approval,pub,1,f.lease,async()=>{throw Error('manager not READY');}),/manager not READY/);
 assert.equal((await f.loader.current())?.epoch,1);
});
test('pointer is a single atomic commit record; journals and key paths are never loader targets',async t=>{
 const f=await fixture(t),pub=f.keys.publicKey.export({format:'pem',type:'spki'}).toString();
 const state=join(f.root,'shared-state');await mkdir(state,{recursive:true});await writeFile(join(state,'journal.json'),'evidence');
 const before=bytesDigest(await readFile(join(state,'journal.json')));
 const pointer=await f.loader.activate(f.approval,pub,1,f.lease,f.auth);
 assert.equal(pointer.previousDigest,digest(f.baseline));
 assert.equal(bytesDigest(await readFile(join(state,'journal.json'))),before);
 assert.equal((await f.loader.current())?.generationId,f.manifest.id);
});

async function readyFence(f:any){
 const fence=await NativeAdmissionFence.open(join(f.root,'next-admission'),'9'.repeat(64));
 const binding={generation:'next',manifestDigest:'8'.repeat(64),sequence:3};
 await fence.closeForDrain(binding);await fence.confirmReady(binding,async()=>{});return fence;
}
