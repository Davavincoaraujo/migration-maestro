import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeAdmissionFence, untrackedNativeClaims, admissionPolicy, persistedSessionObservations } from '../src/agent-runtime/native/admission.js';
import { NativeAdmissionDispatcher } from '../src/agent-runtime/native/admission-dispatch.js';
import { RuntimeJournal } from '../src/agent-runtime/journal.js';
import { digest } from '../src/agent-runtime/contracts.js';
const binding={generation:'candidate',manifestDigest:'a'.repeat(64),sequence:2};
const identity={providerId:'codex-local',taskId:'task',taskDigest:'b'.repeat(64),sessionId:'owned'};
function deferred<T=void>(){let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;
 const promise=new Promise<T>((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
async function fixture(t:any){
 const root=await mkdtemp(join(tmpdir(),'admission-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'fence'),fence=await NativeAdmissionFence.open(path,'c'.repeat(64));
 return {root,path,fence};
}
test('policy explicitly classifies every native adapter operation',()=>{
 assert.deepEqual(Object.keys(admissionPolicy).sort(),['collect','discover','observe','prepare','reconcile','send']);
 for(const m of ['prepare','send','discover','observe'] as const)assert.equal(admissionPolicy[m].mutable,true);
 assert.equal(admissionPolicy.collect.mutable,false);assert.equal(admissionPolicy.reconcile.mutable,false);
});
test('close linearizes synchronously: pending durable reservations count and later work never starts',async t=>{
 const f=await fixture(t),started=deferred(),finish=deferred();
 const first=f.fence.execute('prepare',{providerId:'codex-local',agentId:'Analytics'},async()=>{started.resolve();await finish.promise;return {connectionId:'owned'};});
 const closing=f.fence.closeForDrain(binding);
 let calls=0;
 for(const method of ['prepare','send','discover','observe'] as const)
   await assert.rejects(f.fence.execute(method,identity,async()=>{calls++;}),/ADMISSION_CLOSED/);
 await closing;await started.promise;
 assert.equal((await f.fence.snapshot()).inFlight,1);
 await assert.rejects(f.fence.confirmReady(binding,async()=>{}),/NOT_DRAINED/);
 finish.resolve();await first;
 assert.equal(calls,0);assert.equal((await f.fence.snapshot()).pendingClaims,0);
 await f.fence.confirmReady(binding,async()=>{});
 assert.equal((await f.fence.snapshot()).phase,'READY_TO_ACTIVATE');
 await assert.rejects(f.fence.execute('send',identity,async()=>{}),/ADMISSION_CLOSED/);
});
test('ACK remains pending; null reconciliation and read failure cannot clear claims',async t=>{
 const f=await fixture(t);
 await f.fence.execute('send',identity,async()=>({accepted:true}));
 await f.fence.closeForDrain(binding);
 assert.equal((await f.fence.snapshot()).pendingClaims,1);
 await f.fence.execute('reconcile',identity,async()=>null);
 await assert.rejects(f.fence.execute('collect',identity,async()=>{throw Error('read failure');}),/read failure/);
 await assert.rejects(f.fence.confirmReady(binding,async()=>{}),/NOT_DRAINED/);
 await f.fence.collected(identity,{correlated:true});
 assert.equal((await f.fence.snapshot()).pendingClaims,0);
});
test('timeout, failed prepare and lost connection remain ambiguous even after late remote completion',async t=>{
 const f=await fixture(t),remote=deferred();
 await assert.rejects(f.fence.execute('send',identity,async()=>{void remote.promise;throw Error('TIMEOUT_OUTCOME_UNKNOWN');}),/TIMEOUT/);
 remote.resolve();
 await assert.rejects(f.fence.execute('prepare',{providerId:'codex-local',agentId:'Analytics'},async()=>{throw Error('CHANNEL_CLOSED');}),/CHANNEL_CLOSED/);
 await f.fence.closeForDrain(binding);
 const snapshot=await f.fence.snapshot();
 assert.equal(snapshot.ambiguousDeliveries,2);assert.equal(snapshot.inFlight,0);
 await assert.rejects(f.fence.confirmReady(binding,async()=>{}),/NOT_DRAINED/);
});
test('restart retains unresolved admission and never reopens even formerly OPEN state',async t=>{
 const f=await fixture(t);
 await f.fence.execute('send',identity,async()=>({accepted:true}));
 const restarted=await NativeAdmissionFence.open(f.path,'c'.repeat(64));
 const snapshot=await restarted.snapshot();
 assert.equal(snapshot.recovered,true);assert.equal(snapshot.phase,'DRAINING');assert.equal(snapshot.pendingClaims,1);
 await assert.rejects(restarted.execute('prepare',identity,async()=>{}),/ADMISSION_CLOSED/);
 await restarted.closeForDrain(binding);
 await restarted.collected(identity,{correlated:true});
 await assert.rejects(restarted.confirmReady(binding,async()=>{}),/NOT_DRAINED/);
});
test('crash with persisted running operation becomes ambiguous without replay',async t=>{
 const f=await fixture(t),started=deferred(),done=deferred();
 const running=f.fence.execute('send',identity,async()=>{started.resolve();await done.promise;return {accepted:true};});
 await started.promise;
 const restarted=await NativeAdmissionFence.open(f.path,'c'.repeat(64));
 assert.equal((await restarted.snapshot()).ambiguousDeliveries,1);
 // Old owner cannot publish over the recovered owner's new event.
 done.resolve();await assert.rejects(running);
 assert.equal((await restarted.snapshot()).pendingClaims,1);
});
test('failed persistence rejects provider invocation and keeps admission poisoned',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.path,'0000000001.json'),'conflicting durable event');
 let called=false;
 await assert.rejects(f.fence.execute('send',identity,async()=>{called=true;}));
 assert.equal(called,false);
 assert.equal((await f.fence.snapshot()).poisoned,true);
 await assert.rejects(f.fence.execute('send',identity,async()=>{}),/ADMISSION_CLOSED/);
});
test('partial/corrupt history and altered installation digest are never silently repaired',async t=>{
 const f=await fixture(t);
 await assert.rejects(NativeAdmissionFence.open(f.path,'d'.repeat(64)),/HISTORY_INVALID/);
 await writeFile(join(f.path,'0000000001.json'),'partial');
 await assert.rejects(NativeAdmissionFence.open(f.path,'c'.repeat(64)));
 assert.equal(await readFile(join(f.path,'0000000001.json'),'utf8'),'partial');
});
test('READY survives restart as closed recovery state; failed manager commit does not reopen',async t=>{
 const f=await fixture(t);await f.fence.closeForDrain(binding);
 await assert.rejects(f.fence.confirmReady(binding,async()=>{throw Error('CAS conflict');}),/CAS conflict/);
 assert.equal((await f.fence.snapshot()).phase,'READY_TO_ACTIVATE');
 const restarted=await NativeAdmissionFence.open(f.path,'c'.repeat(64));
 assert.equal(restarted.draining,true);
 await assert.rejects(restarted.execute('discover',identity,async()=>{}),/ADMISSION_CLOSED/);
});
test('untracked legacy claims and corrupt journals block readiness without rewriting them',async t=>{
 const f=await fixture(t),state=join(f.root,'state'),root=join(state,'codex-local','tasks');
 const journal=new RuntimeJournal(root);await journal.initialize();
 await journal.write('task-old.json',{requestDigest:'x',task:{taskId:'old'}},true);
 const before=await readFile(join(root,'task-old.json'));
 const fence=await NativeAdmissionFence.open(join(f.root,'legacy-fence'),'c'.repeat(64),
   ()=>untrackedNativeClaims(state,['codex-local']));
 assert.equal(fence.draining,true);
 await fence.closeForDrain(binding);
 await assert.rejects(fence.confirmReady(binding,async()=>{}),/NOT_DRAINED/);
 assert.deepEqual(await readFile(join(root,'task-old.json')),before);
 await writeFile(join(root,'task-corrupt.json'),'{}');
 await assert.rejects(fence.snapshot(),/JOURNAL_INVALID/);
});
function fakeTransport(){
 const calls:string[]=[];
 const taskResult={payload:{accepted:true},signature:'fixture'};
 return {calls,transport:{
  prepare:async()=>{calls.push('prepare');return {sessionId:'owned'};},
  observations:async()=>{calls.push('observe');return [];},
  cachedObservations:()=>{calls.push('cached');return [{sessionId:'owned',available:false,diagnostics:['DRAINING_CACHED_OBSERVATION_AVAILABILITY_UNVERIFIED']}];},
  sign:(_kind:any,payload:any)=>({payload}),
  discover:async()=>{calls.push('discover');return [];},
  send:async()=>{calls.push('send');return taskResult;},
  reconcile:async()=>{calls.push('reconcile');return null;},
  collect:async()=>{calls.push('collect');return null;}
 }};
}
test('dispatcher keeps draining observe cached and never lazily creates a transport for recovery reads',async t=>{
 const f=await fixture(t),fake=fakeTransport();let creates=0;
 const router=new NativeAdmissionDispatcher(f.fence,[{id:'codex-local',roles:[{agentId:'Analytics',modelId:'model'}]}],
   async()=>{creates++;return fake.transport as any;},()=>fake.transport as any);
 await f.fence.closeForDrain(binding);
 const value=await router.dispatch({transportId:'codex-local',method:'observe',params:{challenge:'read'}});
 assert.equal((value as any).payload[0].available,false);
 assert.deepEqual(fake.calls,['cached']);assert.equal(creates,0);
 for(const method of ['send','discover','prepare']){
   const params={challenge:'test',authorizeSessionCreation:true,agentId:'Analytics',task:{taskId:'task',session:{sessionId:'owned'}}};
   await assert.rejects(router.dispatch({transportId:'codex-local',method,params}),/ADMISSION_CLOSED/);
 }
 const unloaded=new NativeAdmissionDispatcher(f.fence,[{id:'codex-local',roles:[]}],async()=>{creates++;return fake.transport as any;},()=>undefined);
 for(const method of ['observe','reconcile','collect'])
   await assert.rejects(unloaded.dispatch({transportId:'codex-local',method,params:{challenge:'r',task:{taskId:'task',session:{sessionId:'owned'}}}}),/NOT_LOADED/);
 assert.equal(creates,0);
});
test('dispatcher validates collect before settling fence and reconciles without new remote work',async t=>{
 const f=await fixture(t),fake=fakeTransport();
 const task={taskId:'task',session:{sessionId:'owned'}};
 const router=new NativeAdmissionDispatcher(f.fence,[{id:'codex-local',roles:[]}],async()=>fake.transport as any,()=>fake.transport as any);
 await router.dispatch({transportId:'codex-local',method:'send',params:{task,challenge:'s'}});
 await f.fence.closeForDrain(binding);
 await router.dispatch({transportId:'codex-local',method:'reconcile',params:{task,challenge:'r'}});
 await router.dispatch({transportId:'codex-local',method:'collect',params:{task,challenge:'c'}});
 assert.equal((await f.fence.snapshot()).pendingClaims,1);
 fake.transport.collect=async()=>({payload:{accepted:true},signature:'validated-fixture'} as any);
 await router.dispatch({transportId:'codex-local',method:'collect',params:{task,challenge:'c2'}});
 assert.equal((await f.fence.snapshot()).pendingClaims,0);
 assert.deepEqual(fake.calls,['send','reconcile','collect']);
});
test('dispatcher counts queued mutable operations before provider queue admission',async t=>{
 const f=await fixture(t),fake=fakeTransport(),started=deferred(),finish=deferred();
 fake.transport.prepare=async()=>{started.resolve();await finish.promise;return {sessionId:'owned'};};
 const router=new NativeAdmissionDispatcher(f.fence,[{id:'codex-local',roles:[{agentId:'Analytics',modelId:'model'}]}],async()=>fake.transport as any,()=>fake.transport as any);
 const first=router.dispatch({transportId:'codex-local',method:'prepare',params:{agentId:'Analytics',authorizeSessionCreation:true}});
 await started.promise;
 const second=router.dispatch({transportId:'codex-local',method:'discover',params:{challenge:'queued'}});
 await f.fence.closeForDrain(binding);
 assert.equal((await f.fence.snapshot()).inFlight,2);
 finish.resolve();await Promise.all([first,second]);
 assert.equal((await f.fence.snapshot()).inFlight,0);
});
test('task claim coverage is digest-bound and acceptance never clears it',async t=>{
 const f=await fixture(t),task={taskId:'task',session:{sessionId:'owned'}};
 const id={...identity,taskDigest:digest(task)};
 await f.fence.execute('send',id,async()=>({accepted:true}));
 assert.equal(f.fence.covers('codex-local',{task,requestDigest:digest(task)},'task'),true);
 assert.equal(f.fence.covers('other',{task,requestDigest:digest(task)},'task'),false);
 assert.equal(f.fence.covers('codex-local',{task,requestDigest:'bad'},'task'),false);
 assert.equal((await f.fence.snapshot()).pendingClaims,1);
 await assert.rejects(f.fence.collected({...id,taskDigest:'different'},{}),/UNKNOWN_CLAIM/);
});
test('persisted sessions remain observable as detached without starting a driver or writing a journal',async t=>{
 const f=await fixture(t),state=join(f.root,'state'),journal=new RuntimeJournal(join(state,'codex-local','provider'));
 await journal.initialize();
 const name='session-'+digest('owned')+'.json';
 await journal.write(name,{sessionId:'owned',agentId:'Analytics',modelId:'gpt-6-luna',connectionId:'old'},true);
 const before=await readFile(join(journal.root,name));
 const observations=await persistedSessionObservations(state,'codex-local','codex');
 assert.equal(observations[0].ownership,'managed-detached');
 assert.equal(observations[0].available,false);
 assert.equal(observations[0].connectionId,null);
 await f.fence.closeForDrain(binding);
 let created=false;
 const router=new NativeAdmissionDispatcher(f.fence,[{id:'codex-local',roles:[]}],
   async()=>{created=true;throw Error('must not start');},()=>undefined,
   async()=>({payload:await persistedSessionObservations(state,'codex-local','codex')}));
 const result=await router.dispatch({transportId:'codex-local',method:'observe',params:{challenge:'snapshot'}});
 assert.equal((result as any).payload[0].ownership,'managed-detached');assert.equal(created,false);
 assert.deepEqual(await readFile(join(journal.root,name)),before);
});
