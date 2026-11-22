import { sessionBindingDigest, type SessionAttestationProvider } from '../src/sessions/session-attestation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runOperational, readOperationalJson } from '../src/autopilot/operational-run.js';
import { recoverOperationalProbe } from '../src/autopilot/operational-recover.js';
import { snapshotOperational } from '../src/autopilot/operational-reconcile.js';
import { continueOperational } from '../src/autopilot/operational-continuation.js';
import { authorizeContinuation, continuationPaths, inspectContinuationAuthorization, inspectContinuationRecovery, type ContinuationStage } from '../src/autopilot/continuation-authorization.js';
import { syntheticOperationalAgent, syntheticSessionAttestationProvider, syntheticSessionAttestation } from './fixtures/operational-agent.js';
import { validateOperationalPolicy } from '../src/ai/operational-routing.js';
const id='a'.repeat(20);
const policy=validateOperationalPolicy(JSON.parse(await readFile('config/operational-agents.json','utf8')));
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'continuation-')),calls:string[]=[];
  const agent=syntheticOperationalAgent(calls);
  await runOperational({directory,id,kind:'pipeline',policy,planOnly:true,confirmed:true,pollMs:0,
    transport:async(c,a)=>{const result=await agent(c,a);if(c==='ask')throw Error('TIMEOUT');return result;}});
  await recoverOperationalProbe(directory,id,{probeOnly:true,confirmed:true});
  const p=continuationPaths(directory,id),original=await snapshotOperational(p.root);
  const r=await inspectContinuationRecovery(directory,id);
  calls.length=0;
  const approval={confirmed:true,reuseLocalAnalyticsProbe:true,recoveryDigest:r.recoveryDigest,operator:'fixture-operator',
    expiresAt:new Date(Date.now()+3600000).toISOString(),dispatchStages:['ANALYZE','MAP_COMPONENTS','PLAN'] as ContinuationStage[],capabilityProbeAgents:['UE-Pattern']};
  return {directory,p,calls,original,approval,
    approve:()=>authorizeContinuation(directory,id,approval),
    run:(verified=true,transport=agent,provider:SessionAttestationProvider=syntheticSessionAttestationProvider)=>continueOperational({directory,id,confirmed:true,pollMs:0,transport,...(verified?{sessionAttestationProvider:provider}:{})}),
    preserved:async()=>assert.deepEqual(await snapshotOperational(p.root),original),
    cleanup:()=>rm(directory,{recursive:true,force:true})};
}
test('missing authorization fails before transport and all filesystem mutations, including CLI resume',async()=>{
  const f=await fixture();try {
    const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/AUTHORIZATION_REQUIRED/);
    assert.deepEqual(await snapshotOperational(f.directory),before);assert.deepEqual(f.calls,[]);
    // CLI fixture uses its documented relative operations directory; no real job is involved.
    const {mkdir}=await import('node:fs/promises');
    const cwd=await mkdtemp(join(tmpdir(),'continuation-cli-'));
    try {
      const base=join(cwd,'.local-maestro','operations');await mkdir(base,{recursive:true});await cp(f.p.root,join(base,id),{recursive:true});
      const copied=await snapshotOperational(base);
      assert.throws(()=>execFileSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli-operational.ts'),'resume',id,'--confirm-synthetic'],{cwd,stdio:'pipe'}),e=>/CONTINUATION_AUTHORIZATION_REQUIRED/.test(String((e as any).stderr)));
      assert.deepEqual(await snapshotOperational(base),copied);
    }finally{await rm(cwd,{recursive:true,force:true});}
    await f.preserved();
  }finally{await f.cleanup();}
});
test('approval is explicit, hash-bound, immutable and idempotent; inspection is read-only',async()=>{
  const f=await fixture();try {
    await assert.rejects(authorizeContinuation(f.directory,id,{...f.approval,confirmed:false}),/EXPLICIT/);
    await assert.rejects(authorizeContinuation(f.directory,id,{...f.approval,recoveryDigest:'0'.repeat(64)}),/DIGEST_MISMATCH/);
    const a=await f.approve(),before=await snapshotOperational(f.directory);
    assert.equal(a.implementAuthorized,false);assert.equal(a.deliveryAuthenticated,false);
    assert.deepEqual(await f.approve(),a);await inspectContinuationAuthorization(f.directory,id);
    assert.deepEqual(await snapshotOperational(f.directory),before);
    await assert.rejects(authorizeContinuation(f.directory,id,{...f.approval,operator:'different'}),/CONFLICT/);
    await f.preserved();assert.deepEqual(f.calls,[]);
  }finally{await f.cleanup();}
});
for(const field of ['recoveryDigest','jobId','policyDigest','implementAuthorized','deliveryAuthenticated','reuseLocalAnalyticsProbe','expiresAt','dispatchStages']) test('invalid authorization '+field+' cannot mutate or dispatch',async()=>{
  const f=await fixture();try {
    await f.approve();const a=await readOperationalJson(f.p.authorization);
    a[field]=field==='dispatchStages'?['ANALYZE','IMPLEMENT']:field==='implementAuthorized'||field==='deliveryAuthenticated'?true:field==='reuseLocalAnalyticsProbe'?false:'invalid';
    await writeFile(f.p.authorization,JSON.stringify(a));const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/INVALID_CONTINUATION_AUTHORIZATION/);
    assert.deepEqual(await snapshotOperational(f.directory),before);assert.deepEqual(f.calls,[]);
  }finally{await f.cleanup();}
});
for(const field of ['nonce','taskId','probeId','jobId','resultDigest','files','policy','originalDispatch','authorshipAuthenticated','pipelineAdvanceAuthorized']) test('tampered recovery '+field+' fails closed',async()=>{
  const f=await fixture();try {
    await f.approve();const path=join(f.p.root,'analytics-probe-recovery.json'),r=await readOperationalJson(path);
    r[field]=field==='files'?{}:field==='authorshipAuthenticated'||field==='pipelineAdvanceAuthorized'?true:'tampered';
    await writeFile(path,JSON.stringify(r));const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/RECOVERY_MISMATCH/);assert.deepEqual(await snapshotOperational(f.directory),before);assert.deepEqual(f.calls,[]);
  }finally{await f.cleanup();}
});
test('changed source bytes, omitted anchors and symlinks cannot authorize reuse',async()=>{
  const f=await fixture();try {
    await f.approve();const path=join(f.p.root,'status.json');await writeFile(path,(await readFile(path,'utf8'))+' ');
    const before=await snapshotOperational(f.directory);await assert.rejects(f.run(),/RECOVERY_MISMATCH/);assert.deepEqual(await snapshotOperational(f.directory),before);
    await rm(path);await symlink(f.p.authorization,path);await assert.rejects(f.run(),/INVALID_RECONCILIATION_FILE/);
    assert.deepEqual(f.calls,[]);
  }finally{await f.cleanup();}
});
test('concurrent approvals serialize, no replacement; stale controller lock fails closed',async()=>{
  const f=await fixture();try {
    const results=await Promise.allSettled(Array.from({length:8},()=>f.approve()));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(const r of results)if(r.status==='rejected')assert.match(r.reason.message,/LOCKED/);
    await writeFile(join(f.directory,'controller.lock'),'interrupted');const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/LOCKED/);assert.deepEqual(await snapshotOperational(f.directory),before);await f.preserved();
  }finally{await f.cleanup();}
});
test('even verified synthetic session cannot authorize unbound PLAN; blocked recovery is idempotent',async()=>{
  const f=await fixture();try {
    await f.approve();await assert.rejects(f.run(),e=>/SESSION_BOUND_DISPATCH_UNSUPPORTED/.test(String(e)+' '+String((e as Error).cause)));
    assert.equal(f.calls.filter(c=>c.startsWith('ask:')).length,3);
    assert.equal(f.calls.filter(c=>c==='ask:Hermes').length,0);
    const stable=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/SESSION_BOUND_DISPATCH_UNSUPPORTED/);
    assert.deepEqual(await snapshotOperational(f.directory),stable);
    assert.equal(f.calls.filter(c=>c.startsWith('ask:')).length,3);
    const files=await readdir(f.p.executionRoot);
    assert.ok(!files.some(s=>/^(PLAN|IMPLEMENT)\./.test(s)));
    await f.preserved();
  }finally{await f.cleanup();}
});
test('no ADVANCED session blocks PLAN; repeated blocked resume has no writes or sends',async()=>{
  const f=await fixture();try {
    await f.approve();await assert.rejects(f.run(false),e=>/VERIFIED_ADVANCED/.test(String(e)+' '+String((e as Error).cause)));
    assert.equal(f.calls.filter(c=>c==='ask:Hermes').length,0);
    await assert.rejects(readFile(join(f.p.executionRoot,'PLAN.task.json')),{code:'ENOENT'});
    const before=await snapshotOperational(f.directory),calls=[...f.calls];await assert.rejects(f.run(false),e=>/VERIFIED_ADVANCED/.test(String(e)+' '+String((e as Error).cause)));
    assert.deepEqual(await snapshotOperational(f.directory),before);assert.deepEqual(f.calls.filter(c=>c.startsWith('ask:')),calls.filter(c=>c.startsWith('ask:')));await f.preserved();
  }finally{await f.cleanup();}
});
test('local reuse alone grants no stage; stages alone grant no implicit mapper probe',async()=>{
  const f=await fixture();try {
    await authorizeContinuation(f.directory,id,{...f.approval,dispatchStages:[],capabilityProbeAgents:[]});
    const before=await snapshotOperational(f.directory);await assert.rejects(f.run(),/STAGE_NOT_AUTHORIZED/);
    assert.deepEqual(await snapshotOperational(f.directory),before);assert.deepEqual(f.calls,[]);
  }finally{await f.cleanup();}
  const g=await fixture();try {
    await authorizeContinuation(g.directory,id,{...g.approval,capabilityProbeAgents:[]});
    await assert.rejects(g.run(),e=>String(e).includes('Checkpointed stage failed'));
    assert.deepEqual(g.calls.filter(c=>c.startsWith('ask:')),['ask:Analytics']);await g.preserved();
  }finally{await g.cleanup();}
});
test('new ambiguous dispatch requires new review, even with a result; never duplicated on resume',async()=>{
  const f=await fixture();try {
    await f.approve();const agent=syntheticOperationalAgent(f.calls);
    await assert.rejects(f.run(true,async(c,a)=>{const result=await agent(c,a);if(c==='ask')throw Error('TIMEOUT');return result;}));
    assert.equal(f.calls.filter(c=>c.startsWith('ask:')).length,1);
    const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/AMBIGUOUS_DISPATCH/);assert.deepEqual(await snapshotOperational(f.directory),before);
    assert.equal(f.calls.filter(c=>c.startsWith('ask:')).length,1);await f.preserved();
  }finally{await f.cleanup();}
});
test('expired approvals and interrupted claims fail closed without replacing any evidence',async()=>{
  const f=await fixture();try {
    await f.approve();const a=await readOperationalJson(f.p.authorization);
    a.issuedAt=new Date(Date.now()-7200000).toISOString();a.expiresAt=new Date(Date.now()-3600000).toISOString();
    await writeFile(f.p.authorization,JSON.stringify(a));const before=await snapshotOperational(f.directory);
    await assert.rejects(f.run(),/INVALID_CONTINUATION_AUTHORIZATION/);assert.deepEqual(await snapshotOperational(f.directory),before);
  }finally{await f.cleanup();}
  const g=await fixture();try {
    await g.approve();const agent=syntheticOperationalAgent(g.calls);
    await assert.rejects(g.run(true,async(c,a)=>{const result=await agent(c,a);if(c==='ask')throw Error('TIMEOUT');return result;}));
    await rm(join(g.p.executionRoot,'ANALYZE.dispatch-receipt.json'));
    const before=await snapshotOperational(g.directory);await assert.rejects(g.run(),/AMBIGUOUS_DISPATCH/);
    assert.deepEqual(await snapshotOperational(g.directory),before);assert.equal(g.calls.filter(c=>c.startsWith('ask:')).length,1);
  }finally{await g.cleanup();}
});

for(const mode of ['missing','identity','model','expired','unavailable','session-switch']) test('continuation gate blocks PLAN with attestation '+mode,async()=>{
  const f=await fixture();try {
    await f.approve();let calls=0;
    const provider:SessionAttestationProvider={id:'test-session-provider',async attest(request){
      calls++;
      if(mode==='missing')return {status:'unverified',reason:'SESSION_MISSING'};
      if(mode==='unavailable')throw Error('offline');
      const a=syntheticSessionAttestation(request);
      if(mode==='identity')a.binding.agentId='Other';
      if(mode==='model')a.binding.modelId='Other';
      if(mode==='expired')a.expiresAt='2000-01-01T00:00:00Z';
      if(mode==='session-switch')a.binding.sessionId='session-'+calls;
      a.evidence.bindingDigest=sessionBindingDigest(a.binding);return a;
    }};
    await assert.rejects(f.run(true,syntheticOperationalAgent(f.calls),provider));
    assert.ok(calls>0);assert.equal(f.calls.filter(c=>c==='ask:Hermes').length,0);
    await assert.rejects(readFile(join(f.p.executionRoot,'PLAN.task.json')),{code:'ENOENT'});
    await assert.rejects(readFile(join(f.p.executionRoot,'IMPLEMENT.task.json')),{code:'ENOENT'});
    await f.preserved();
  }finally{await f.cleanup();}
});
