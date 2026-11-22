import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp,mkdir,readFile,rm,writeFile,readdir,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical,bytesDigest,digest,teamStages,type AgentRuntimeTransport,type RuntimeSession,type SignedEvidence,type RuntimeTask,type Delivery,type CollectedResult,type SessionProof } from '../src/agent-runtime/contracts.js';
import { AgentRuntimeRegistry } from '../src/agent-runtime/registry.js';
import { authorizationTemplate,runMigrationTeam,type TeamAuthorization } from '../src/autopilot/migration-team.js';
import { inspectTeamCoordination,loadTeamRegistry } from '../src/agent-runtime/adapters.js';
import { RuntimeJournal } from '../src/agent-runtime/journal.js';

async function fixture(provider:'codex'|'claude-code'='codex') {
 const root=await mkdtemp(join(tmpdir(),'migration-team-')),history=join(root,'history'),run=join(root,'run');await mkdir(history);
 await writeFile(join(history,'unchanged'),'historical bytes');
 const keys=generateKeyPairSync('ed25519'),id='fixture';
 const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
 const sessions:RuntimeSession[]=[['Migration Orchestrator','coordination','ADVANCED'],['Analytics','analysis','ECONOMY'],['UE-Pattern','mapping','BALANCED'],['Hermes','planning,coding','ADVANCED'],['Quality','validation','BALANCED']].map(([agentId,capabilities,profile])=>({version:2,transportId:id,agentId,provider,modelId:provider+'-verified-model',profile:profile as RuntimeSession['profile'],capabilities:capabilities.split(','),available:true,sessionId:agentId+'-session',connectionId:'epoch-1',workspaceId:'test-workspace',address:{kind:'runtime',protocol:provider==='codex'?'codex-app-server':'claude-agent-sdk'}}));
 const state={send:[] as RuntimeTask[],reconcile:[] as string[],badDelivery:false,ambiguous:false,pending:false,badArtifact:false,badResult:false,badSignature:false,expired:false,wrongAuthor:false,unavailable:false,failValidation:false};
 const signed=<T>(kind:SignedEvidence<T>['kind'],payload:T,challenge:string):SignedEvidence<T>=>{
   const at=Date.now()-(state.expired?120000:0);
   const body={version:1 as const,issuer:id,kind,challenge,issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString(),payload};
   return {...body,signature:sign(null,Buffer.from(canonical(body)),keys.privateKey).toString('base64')};
 };
 const receipt=(task:RuntimeTask):Delivery=>({taskId:task.taskId,requestDigest:digest(task),sessionDigest:digest(task.session),receiptId:'receipt-'+task.taskId,accepted:true});
 const transport:AgentRuntimeTransport={id,mode:'simulation',support:{discovery:true,sessionBoundDispatch:true,reconciliation:true,results:true},
  discover:async challenge=>state.unavailable?[]:sessions.map(session=>signed<SessionProof>('session',{session,guarantees:{identity:true,model:true,profile:true,capabilities:true,availability:true,scopeEnforced:true}},challenge)),
  send:async(task,challenge)=>{
    state.send.push(structuredClone(task));
    if(state.ambiguous)throw Error('LOST_CONNECTION_AFTER_DELIVERY');
    const proof=signed('delivery',{...receipt(task),...(state.badDelivery?{requestDigest:'0'.repeat(64)}:{})},challenge);
    if(state.badSignature)proof.signature=Buffer.alloc(64).toString('base64');return proof;
  },
  reconcile:async(task,challenge)=>{state.reconcile.push(task.stage);return signed('delivery',receipt(task),challenge);},
  collect:async(task,challenge)=>{
    if(state.pending)return null;
    const outputKey={ANALYZE:'inventory',DISCOVER_COMPONENTS:'components',MAP_COMPONENTS:'mappings',PLAN:'steps',IMPLEMENT:'files',VALIDATE:'checks'}[task.stage];
    const output={version:1,jobId:task.jobId,taskId:task.taskId,stage:task.stage,inputs:task.inputs,[outputKey]:['fixture '+task.stage],limitations:['Simulation only'],...(task.stage==='VALIDATE'?{passed:!state.failValidation}:{})};
    const bytes=Buffer.from(JSON.stringify(output)),file=task.stage+'.output.json';
    const value:CollectedResult={...receipt(task),result:{version:2,jobId:task.jobId,taskId:task.taskId,stage:task.stage,status:'completed',summary:'simulated outcome',evidence:['fixture'],artifacts:[{file,digest:bytesDigest(bytes)}]},artifacts:[{file,bytesBase64:(state.badArtifact?Buffer.from('tampered'):bytes).toString('base64')}]};
    if(state.badResult)(value.result as any).stage='WRONG';
    if(state.wrongAuthor)value.sessionDigest='0'.repeat(64);
    return signed('result',value,challenge);
  }
 };
 const anchors=[{transportId:id,publicKey,mode:'simulation' as const,moduleDigest:'a'.repeat(64)}];
 const registry=new AgentRuntimeRegistry([transport],anchors,'simulation');await registry.refresh();
 const html='<html><body>Fixture</body></html>';
 const source={jobId:'6c23a49df3f6b1798231',url:'https://banco.bradesco/html/classic/atendimento/atendimento.shtm',html,sha256:bytesDigest(html),historyDigest:'b'.repeat(64)};
 const runId='integration';
 const authorization:TeamAuthorization={...authorizationTemplate(source,registry,runId),approvedBy:'test operator',expiresAt:new Date(Date.now()+60000).toISOString()};
 const execute=(extra:Partial<Parameters<typeof runMigrationTeam>[0]>={})=>runMigrationTeam({source,registry,authorization,runId,runDirectory:run,historicalRoot:history,...extra});
 return {root,history,run,source,authorization,registry,transport,sessions,state,execute,anchors,cleanup:()=>rm(root,{recursive:true,force:true})};
}
for(const provider of ['codex','claude-code'] as const)test(`full team pipeline on ${provider}: shared contract, dependencies, ADVANCED and immutable history`,async()=>{
 const f=await fixture(provider);try {
  const result=await f.execute();assert.equal(result.state,'awaiting-review');assert.equal(result.completed.length,6);
  assert.deepEqual(f.state.send.map(t=>t.agentId),['Analytics','UE-Pattern','UE-Pattern','Hermes','Hermes','Quality']);
  assert.deepEqual(f.state.send.map(t=>t.stage),teamStages);
  for(const task of f.state.send) {
    assert.equal(task.session.provider,provider);assert.equal(task.scope,'artifact-only-no-external-writes');
    assert.equal(task.source.html,f.source.html);assert.equal(task.resultContractVersion,2);
    if(task.stage==='PLAN'||task.stage==='IMPLEMENT')assert.equal(task.session.profile,'ADVANCED');
    if(task.stage!=='ANALYZE')assert.ok(task.inputArtifacts.length);
  }
  await f.execute();assert.equal(f.state.send.length,6);
  assert.equal(await readFile(join(f.history,'unchanged'),'utf8'),'historical bytes');assert.deepEqual(await readdir(f.history),['unchanged']);
 }finally{await f.cleanup();}
});
test('registry blocks absent/unavailable/unverified sessions and never downgrades Hermes',async()=>{
 const f=await fixture();try {
 f.sessions.find(s=>s.agentId==='Hermes')!.profile='BALANCED';await f.registry.refresh();
 assert.equal(f.registry.route('PLAN').session,undefined);assert.equal(f.registry.route('IMPLEMENT').session,undefined);
 f.sessions.find(s=>s.agentId==='Analytics')!.available=false;await f.registry.refresh();assert.equal(f.registry.route('ANALYZE').session,undefined);
 f.state.expired=true;await f.registry.refresh();assert.equal(f.registry.current().length,0);
 const forged=new AgentRuntimeRegistry([f.transport],[{...f.anchors[0],publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}],'simulation');
 f.state.expired=false;await forged.refresh();assert.equal(forged.current().length,0);
 }finally{await f.cleanup();}
});
test('an ambiguous dispatch is reconciled on restart without resend, reroute or dependent tasks',async()=>{
 const f=await fixture();try {
 f.state.ambiguous=true;await assert.rejects(f.execute(),(e:any)=>e.cause?.message==='TEAM_DELIVERY_AMBIGUOUS_RECONCILE_ONLY');
 assert.equal(f.state.send.length,1);assert.equal(f.state.send[0].stage,'ANALYZE');
 f.state.ambiguous=false;
 const registry=new AgentRuntimeRegistry([f.transport],f.anchors,'simulation');
 await f.execute({registry});assert.equal(f.state.send.length,6);assert.deepEqual(f.state.reconcile,['ANALYZE']);
 }finally{await f.cleanup();}
});
for(const flag of ['badDelivery','badSignature'] as const)test(`${flag} never marks delivered or starts downstream tasks`,async()=>{
 const f=await fixture();try {
 f.state[flag]=true;await assert.rejects(f.execute());
 assert.equal(f.state.send.length,1);assert.ok(!(await readdir(f.run)).includes('ANALYZE.delivery.json'));
 assert.ok(!(await readdir(f.run)).includes('ANALYZE.checkpoint.json'));
 }finally{await f.cleanup();}
});
for(const flag of ['badArtifact','badResult','wrongAuthor'] as const)test(`${flag} is rejected by generic collector`,async()=>{
 const f=await fixture();try {
 f.state[flag]=true;await assert.rejects(f.execute());assert.equal(f.state.send.length,1);
 assert.ok(!(await readdir(f.run)).includes('ANALYZE.checkpoint.json'));
 f.state[flag]=false;await f.execute();assert.equal(f.state.send.length,6);
 }finally{await f.cleanup();}
});
test('pending results resume by collecting only and never complete ANALYZE from source capture',async()=>{
 const f=await fixture();try {
 f.state.pending=true;await assert.rejects(f.execute());assert.equal(f.state.send.length,1);
 const checkpoint=await new RuntimeJournal(f.run).read<any>('autopilot.checkpoint.json');assert.deepEqual(checkpoint.completed,[]);
 f.state.pending=false;await f.execute();assert.equal(f.state.send.length,6);assert.equal(f.state.reconcile.length,0);
 }finally{await f.cleanup();}
});
test('authorization and coordinator session gates run before claims',async()=>{
 const f=await fixture();try {
 await assert.rejects(f.execute({authorization:{...f.authorization,approvedBy:''}}),/AUTHORIZATION/);
 f.sessions.find(s=>s.agentId==='Migration Orchestrator')!.capabilities=[];
 await assert.rejects(f.execute(),/AUTHORIZATION/);assert.equal(f.state.send.length,0);
 }finally{await f.cleanup();}
});
test('session generation changes after ambiguity cannot rebind the claim',async()=>{
 const f=await fixture();try {
 f.state.ambiguous=true;await assert.rejects(f.execute());f.state.ambiguous=false;
 f.sessions.find(s=>s.agentId==='Analytics')!.connectionId='epoch-2';
 await assert.rejects(f.execute());assert.equal(f.state.send.length,1);assert.equal(f.state.reconcile.length,0);
 }finally{await f.cleanup();}
});
test('checkpoint tampering is detected before cached completion is reused',async()=>{
 const f=await fixture();try {
 await f.execute({pauseAfter:'ANALYZE'});
 const path=join(f.run,'ANALYZE.checkpoint.json'),record=JSON.parse(await readFile(path,'utf8'));
 record.payload.proof.payload.result.summary='tampered';record.digest=digest(record.payload);await writeFile(path,JSON.stringify(record));
 await assert.rejects(f.execute());assert.equal(f.state.send.length,1);
 }finally{await f.cleanup();}
});
test('historical path and symlink aliases are refused; run lock prevents concurrent sending',async()=>{
 const f=await fixture();try {
 await assert.rejects(f.execute({runDirectory:join(f.history,'new')}),/HISTORY_WRITE/);
 await symlink(f.history,join(f.root,'alias'));
 await assert.rejects(f.execute({runDirectory:join(f.root,'alias','new')}),/HISTORY_WRITE/);
 const journal=new RuntimeJournal(f.run),release=await journal.lock();
 try{await assert.rejects(f.execute(),/LOCKED/);}finally{await release();}
 assert.equal(f.state.send.length,0);
 }finally{await f.cleanup();}
});
test('Maestri listing is coordination only, and production CLI has no simulated fallback',async()=>{
 const result=await inspectTeamCoordination(async(command)=>{assert.equal(command,'list');return 'Connected agents: name: "Analytics" name: "Hermes"';});
 assert.deepEqual(result.connectedNames,['Analytics','Hermes']);assert.equal(result.sessionVerified,false);assert.equal(result.deliverySupported,false);
 const registry=await loadTeamRegistry();await registry.refresh();assert.equal(registry.current().length,0);
 const f=await fixture();try {const live=new AgentRuntimeRegistry([f.transport],f.anchors);await live.refresh();assert.equal(live.current().length,0);}finally{await f.cleanup();}
});
test('failed validation remains incomplete',async()=>{
 const f=await fixture();try {
 f.state.failValidation=true;await assert.rejects(f.execute());
 assert.equal((await new RuntimeJournal(f.run).read<any>('autopilot.checkpoint.json')).completed.length,5);
 }finally{await f.cleanup();}
});
test('interruption after result commit repairs Autopilot checkpoint without another send',async()=>{
 const f=await fixture();try {
 await f.execute({pauseAfter:'ANALYZE'});
 await rm(join(f.run,'autopilot.checkpoint.json'));
 await f.execute();assert.equal(f.state.send.length,6);assert.equal(f.state.reconcile.length,0);
 }finally{await f.cleanup();}
});
test('source and authorization changes cannot reuse a run identity',async()=>{
 const f=await fixture();try {
 await f.execute({pauseAfter:'ANALYZE'});
 await assert.rejects(f.execute({source:{...f.source,historyDigest:'c'.repeat(64)}}),/RUN_CONFLICT/);
 await assert.rejects(f.execute({authorization:{...f.authorization,stages:['ANALYZE']}}),/RUN_CONFLICT/);
 assert.equal(f.state.send.length,1);
 }finally{await f.cleanup();}
});
test('loader rejects modified module bytes before evaluating adapter code',async()=>{
 const f=await fixture();try {
 const module=join(f.root,'adapter.mjs'),config=join(f.root,'adapters.json');
 await writeFile(module,'throw new Error("MUST_NOT_EXECUTE")');
 await writeFile(config,JSON.stringify({version:1,adapters:[{id:'fixture',module,sha256:'0'.repeat(64),publicKey:f.anchors[0].publicKey}]}));
 await assert.rejects(loadTeamRegistry(config),/MODULE_DIGEST_MISMATCH/);
 }finally{await f.cleanup();}
});
test('missing reconciliation support is a hard registry gate even with valid signatures',async()=>{
 const f=await fixture();try {
 f.transport.support.reconciliation=false;await f.registry.refresh();assert.equal(f.registry.current().length,0);
 assert.equal(f.registry.diagnostics[0].reason,'RUNTIME_TRANSPORT_UNSUPPORTED');
 }finally{await f.cleanup();}
});
test('explicit authorization renewal preserves task identity and records both approvals',async()=>{
 const f=await fixture();try {
 f.state.pending=true;await assert.rejects(f.execute());
 const taskId=f.state.send[0].taskId;f.state.pending=false;
 await f.execute({authorization:{...f.authorization,approvedBy:'renewing operator',expiresAt:new Date(Date.now()+120000).toISOString()}});
 assert.equal(f.state.send.filter(t=>t.stage==='ANALYZE').length,1);assert.equal(f.state.send[0].taskId,taskId);
 assert.equal((await readdir(f.run)).filter(n=>n.startsWith('authorization-')).length,2);
 }finally{await f.cleanup();}
});
test('another run cannot resend the same job under a new identity',async()=>{
 const f=await fixture();try {
 f.state.ambiguous=true;await assert.rejects(f.execute());
 await assert.rejects(f.execute({runId:'another',runDirectory:join(f.root,'another'),authorization:{...f.authorization,runId:'another'}}),/ALREADY_BOUND_TO_RUN/);
 assert.equal(f.state.send.length,1);
 }finally{await f.cleanup();}
});
