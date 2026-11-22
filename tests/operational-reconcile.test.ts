import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { reconcileOperational } from '../src/autopilot/operational-reconcile.js';
import { dispatchDigest } from '../src/autopilot/dispatch-executor.js';
const id='a'.repeat(20), taskId='11111111-1111-1111-1111-111111111111';
const agent={agentId:'Analytics',mode:'declared',provider:'codex',modelId:'gpt-6.1-sol',capabilities:['analysis','validation']};
const probeId=createHash('sha256').update(agent.agentId).digest('hex').slice(0,20);
async function fixture() {
  const cwd=await mkdtemp(join(tmpdir(),'reconcile-test-')),base=join(cwd,'.local-maestro','operations'),root=join(base,id),probe=join(root,'probes',probeId);
  await mkdir(probe,{recursive:true});
  const put=(name:string,value:unknown)=>writeFile(join(root,name),JSON.stringify(value));
  const selected={agentId:agent.agentId,mode:'capability-probe',policyDigest:dispatchDigest(agent)};
  const routeDigest=dispatchDigest(selected),nonce='b'.repeat(32);
  const request={version:1,jobId:probeId,taskId,stage:'CAPABILITY',agentId:agent.agentId,routeDigest,prompt:'Synthetic persisted fixture'};
  const requestDigest=dispatchDigest(request);
  const attempt={version:1,taskId,agentId:agent.agentId,requestDigest,identity:{executorId:'test-fixture'},at:'2026-01-01T00:00:00Z'};
  await put('operation.json',{version:1,jobId:id,kind:'pipeline',planOnly:true,policy:{version:1,scope:'isolated-synthetic',maxRisk:'MEDIUM',agents:[agent]}});
  await put(id+'.checkpoint.json',{version:1,jobId:id,inputDigest:'c'.repeat(64),completed:[],outputs:{},state:'failed'});
  const prefix='probes/'+probeId+'/';
  await put(prefix+'CAPABILITY.route.json',{selected});
  await put(prefix+'CAPABILITY.task.json',{taskId,stage:'CAPABILITY',agentId:agent.agentId,routeDigest,requestDigest,nonce,polls:0});
  await put(prefix+'CAPABILITY.dispatch.json',request);
  await put(prefix+'CAPABILITY.dispatch-attempt.json',attempt);
  await put(prefix+'CAPABILITY.dispatch-receipt.json',{...attempt,attemptDigest:dispatchDigest(attempt),outcome:'unknown',finishedAt:'2026-01-01T00:00:10Z',deliveryVerified:false});
  await put(prefix+'capability.json',{version:1,jobId:probeId,taskId,nonce,analysis:{componentCount:2},validation:['broken']});
  return {cwd,base,root,probe,put,prefix,cleanup:()=>rm(cwd,{recursive:true,force:true})};
}
async function tree(root:string):Promise<unknown> {
  const entries=[];
  for(const name of (await readdir(root)).sort()) {const p=join(root,name),s=await stat(p); entries.push([name,s.mtimeMs,s.mode,s.isDirectory()?await tree(p):(await readFile(p)).toString('base64')]);}
  return entries;
}
test('CLI dry-run validates unknown delivery offline with no file or directory mutations',async()=>{
  const f=await fixture();
  try {
    const sentinel=join(f.cwd,'transport-called');
    const fake=join(f.cwd,'maestri');
    await writeFile(fake,'#!/bin/sh\ntouch "'+sentinel+'"\nexit 99\n',{mode:0o700});
    const before=await tree(f.root);
    const raw=execFileSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli-operational.ts'),'reconcile',id,'--dry-run'],{cwd:f.cwd,env:{...process.env,MAESTRI_CLI:fake,PATH:f.cwd+':'+process.env.PATH},encoding:'utf8'});
    const r=JSON.parse(raw);
    assert.equal(r.state,'local-evidence-valid'); assert.equal(r.planOnly,true);
    assert.equal(r.evidence[0].outcome,'unknown'); assert.equal(r.evidence[0].proofPresent,false);
    assert.equal(r.deliveryAuthenticated,false);assert.equal(r.authorshipAuthenticated,false);
    assert.deepEqual(await tree(f.root),before);
    await assert.rejects(stat(sentinel),{code:'ENOENT'});
    await assert.rejects(stat(join(f.probe,'proof.json')),{code:'ENOENT'});
    assert.throws(()=>execFileSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli-operational.ts'),'reconcile',id],{cwd:f.cwd,stdio:'pipe'}));
    assert.deepEqual(await tree(f.root),before);
  } finally {await f.cleanup();}
});
for(const field of ['nonce','taskId','jobId','analysis']) test('invalid probe '+field+' is rejected without mutation',async()=>{
  const f=await fixture();try {
    const value=JSON.parse(await readFile(join(f.probe,'capability.json'),'utf8'));value[field]=field==='analysis'?{componentCount:9}:'wrong';
    await f.put(f.prefix+'capability.json',value); const before=await tree(f.root);
    assert.equal((await reconcileOperational(f.base,id)).state,'invalid');assert.deepEqual(await tree(f.root),before);
  }finally{await f.cleanup();}
});
for(const file of ['CAPABILITY.route.json','CAPABILITY.dispatch.json','CAPABILITY.dispatch-attempt.json','CAPABILITY.dispatch-receipt.json']) test('corrupt provenance '+file,async()=>{
  const f=await fixture();try{await f.put(f.prefix+file,{});const before=await tree(f.root);assert.equal((await reconcileOperational(f.base,id)).state,'invalid');assert.deepEqual(await tree(f.root),before);}finally{await f.cleanup();}
});
test('missing result is pending; missing outcome accepts valid local evidence; policy and proof changes fail',async()=>{
  const f=await fixture();try{
    await rm(join(f.probe,'CAPABILITY.dispatch-receipt.json'));
    assert.equal((await reconcileOperational(f.base,id)).evidence[0].outcome,'not-recorded');
    await f.put(f.prefix+'proof.json',{artifactDigest:'wrong'});
    assert.equal((await reconcileOperational(f.base,id)).state,'invalid');
    await rm(join(f.probe,'proof.json'));await rm(join(f.probe,'capability.json'));
    assert.equal((await reconcileOperational(f.base,id)).state,'pending');
    const op=JSON.parse(await readFile(join(f.root,'operation.json'),'utf8'));op.policy.agents[0].modelId='changed';await f.put('operation.json',op);
    assert.equal((await reconcileOperational(f.base,id)).state,'invalid');
  }finally{await f.cleanup();}
});
test('legacy stage result is inspected without inventing executor evidence',async()=>{
  const f=await fixture();try{
    await f.put('ANALYZE.task.json',{taskId,stage:'ANALYZE',agentId:'Analytics',polls:0});
    await f.put('ANALYZE.route.json',{selected:{agentId:'Analytics'}});
    await f.put('ANALYZE.result.json',{taskId,stage:'ANALYZE',status:'completed',summary:'fixture',evidence:['fixture']});
    const before=await tree(f.root),r=await reconcileOperational(f.base,id);
    assert.equal(r.evidence[1].provenance,'legacy-route-only');assert.equal(r.evidence[1].state,'local-result-valid');assert.deepEqual(await tree(f.root),before);
  }finally{await f.cleanup();}
});
test('v2 stage artifact hashes and checkpoint bindings are validated read-only',async()=>{
  const f=await fixture();try{
    const selected={agentId:'Analytics'},routeDigest=dispatchDigest(selected);
    const request={version:1,resultContractVersion:2,jobId:id,taskId,stage:'ANALYZE',agentId:'Analytics',routeDigest,prompt:'fixture'};
    const requestDigest=dispatchDigest(request),task={taskId,stage:'ANALYZE',agentId:'Analytics',routeDigest,requestDigest,resultContractVersion:2,polls:0};
    await f.put('ANALYZE.route.json',{selected});await f.put('ANALYZE.task.json',task);await f.put('ANALYZE.dispatch.json',request);
    await f.put('ANALYZE.dispatch-attempt.json',{taskId,agentId:'Analytics',requestDigest,identity:{executorId:'fixture'}});
    await f.put('artifact.json',{ok:true});const digest=createHash('sha256').update(await readFile(join(f.root,'artifact.json'))).digest('hex');
    await f.put('ANALYZE.result.json',{version:2,jobId:id,taskId,stage:'ANALYZE',status:'completed',summary:'fixture',evidence:['fixture'],artifacts:[{file:'artifact.json',digest}]});
    const before=await tree(f.root);assert.equal((await reconcileOperational(f.base,id)).evidence[1].state,'local-result-valid');assert.deepEqual(await tree(f.root),before);
    await f.put(id+'.checkpoint.json',{version:1,jobId:id,inputDigest:'c'.repeat(64),completed:['analyze'],outputs:{analyze:{resultDigest:'wrong'}},state:'failed'});
    assert.equal((await reconcileOperational(f.base,id)).evidence[1].pending[0],'CHECKPOINT_RESULT_CHANGED');
    await f.put('artifact.json',{ok:false});assert.equal((await reconcileOperational(f.base,id)).evidence[1].pending[0],'RESULT_ARTIFACT_DIGEST_MISMATCH');
  }finally{await f.cleanup();}
});

const { recoverOperationalProbe } = await import('../src/autopilot/operational-recover.js');
const recoveryOptions = {probeOnly:true,confirmed:true};
test('probe recovery publishes only a separate receipt, is idempotent and never dispatches',async()=>{
  const f=await fixture();try {
    const original=await tree(f.root);
    const fake=join(f.cwd,'maestri'),sentinel=join(f.cwd,'transport-called');
    await writeFile(fake,'#!/bin/sh\ntouch "'+sentinel+'"\nexit 99\n',{mode:0o700});
    const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli-operational.ts'),'recover',id,'--probe-only','--confirm-synthetic'];
    const run=()=>JSON.parse(execFileSync(process.execPath,args,{cwd:f.cwd,env:{...process.env,MAESTRI_CLI:fake,PATH:f.cwd+':'+process.env.PATH},encoding:'utf8'}));
    const r=run(),after=await tree(f.root);
    assert.equal(r.kind,'local-reconciled-probe');assert.equal(r.originalDispatch.outcome,'unknown');
    assert.equal(r.originalDispatch.deliveryVerified,false);assert.equal(r.deliveryAuthenticated,false);
    assert.equal(r.authorshipAuthenticated,false);assert.equal(r.analyzeCompleted,false);
    assert.equal(r.pipelineAdvanceAuthorized,false);assert.equal(r.nonce,'b'.repeat(32));
    assert.deepEqual(run(),r);assert.deepEqual(await tree(f.root),after);
    assert.deepEqual((after as any[]).filter(e=>e[0]!=='analytics-probe-recovery.json'),original);
    await assert.rejects(stat(sentinel),{code:'ENOENT'});
    await assert.rejects(stat(join(f.probe,'proof.json')),{code:'ENOENT'});
    assert.throws(()=>execFileSync(process.execPath,args.slice(0,-1),{cwd:f.cwd,stdio:'pipe'}));
  }finally{await f.cleanup();}
});
for(const file of ['capability.json','CAPABILITY.dispatch-receipt.json','CAPABILITY.dispatch.json','CAPABILITY.route.json','CAPABILITY.task.json']) test('recovery fails closed on missing or inconsistent '+file,async()=>{
  const f=await fixture();try {
    await f.put(f.prefix+file,{});let before=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions));assert.deepEqual(await tree(f.root),before);
    await rm(join(f.probe,file));before=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions));assert.deepEqual(await tree(f.root),before);
  }finally{await f.cleanup();}
});
test('concurrent recoveries publish once; changed evidence cannot replace a receipt',async()=>{
  const f=await fixture();try {
    const results=await Promise.allSettled(Array.from({length:8},()=>recoverOperationalProbe(f.base,id,recoveryOptions)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(const r of results) if(r.status==='rejected') assert.match(r.reason.message,/OPERATION_LOCKED/);
    await recoverOperationalProbe(f.base,id,recoveryOptions);
    const old=await readFile(join(f.root,'analytics-probe-recovery.json'));
    const value=JSON.parse(await readFile(join(f.probe,'capability.json'),'utf8'));value.extra='changed but valid';
    await f.put(f.prefix+'capability.json',value);const before=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions),/RECOVERY_RECORD_CONFLICT/);
    assert.deepEqual(await tree(f.root),before);assert.deepEqual(await readFile(join(f.root,'analytics-probe-recovery.json')),old);
  }finally{await f.cleanup();}
});
test('confirmation, planOnly and leftover interruption lock fail closed',async()=>{
  const f=await fixture();try {
    const before=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,{probeOnly:true,confirmed:false}));
    await writeFile(join(f.base,'operation.lock'),'interrupted');
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions),/OPERATION_LOCKED/);
    assert.deepEqual(await tree(f.root),before);
    await rm(join(f.base,'operation.lock'));
    const op=JSON.parse(await readFile(join(f.root,'operation.json'),'utf8'));op.planOnly=false;await f.put('operation.json',op);
    const changed=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions),/REQUIRES_PLAN_ONLY/);
    assert.deepEqual(await tree(f.root),changed);
  }finally{await f.cleanup();}
});
test('direct controller lock blocks recovery without altering records',async()=>{
  const f=await fixture();try {
    await writeFile(join(f.base,'controller.lock'),'active');const before=await tree(f.root);
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions),/CONTROLLER_LOCKED/);
    assert.deepEqual(await tree(f.root),before);
    assert.equal(await readFile(join(f.base,'controller.lock'),'utf8'),'active');
    await assert.rejects(stat(join(f.base,'operation.lock')),{code:'ENOENT'});
  }finally{await f.cleanup();}
});

test('recovery rejects promotion of an ambiguous CLI receipt to authenticated delivery',async()=>{
  const f=await fixture();try {
    const path=join(f.probe,'CAPABILITY.dispatch-receipt.json');
    const receipt=JSON.parse(await readFile(path,'utf8'));
    receipt.deliveryVerified=true;
    await writeFile(path,JSON.stringify(receipt));
    const before=await tree(f.root);
    assert.equal((await reconcileOperational(f.base,id)).state,'invalid');
    await assert.rejects(recoverOperationalProbe(f.base,id,recoveryOptions));
    assert.deepEqual(await tree(f.root),before);
  }finally{await f.cleanup();}
});
