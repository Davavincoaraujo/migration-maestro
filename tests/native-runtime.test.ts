import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,randomUUID } from 'node:crypto';
import { mkdtemp,rm,writeFile,readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerDriver } from '../src/agent-runtime/native/codex.js';
import { ClaudeAgentSdkDriver,type ClaudeSdk } from '../src/agent-runtime/native/claude.js';
import { CodexStdio,type RpcPeer } from '../src/agent-runtime/native/protocol.js';
import { NativeAgentTransport } from '../src/agent-runtime/native/transport.js';
import { RuntimeJournal } from '../src/agent-runtime/journal.js';
import { AgentRuntimeRegistry } from '../src/agent-runtime/registry.js';
import { digest,bytesDigest,type RuntimeTask } from '../src/agent-runtime/contracts.js';
import { initializeNativeService,serveNativeRuntimes,type NativeServiceConfig } from '../src/agent-runtime/native/service.js';
import { nativeRequest } from '../src/agent-runtime/native/client.js';
const signal=()=>new AbortController().signal;
async function fixture(){const root=await mkdtemp(join(tmpdir(),'native-runtime-'));return {root,cleanup:()=>Promise.all([rm(root,{recursive:true,force:true}),rm(root+'.admission',{recursive:true,force:true})])};}
class OfficialFrames implements RpcPeer {
 calls:{method:string;params:any}[]=[];listener:(method:string,params:any)=>void=()=>{};model='observed-model';status='inProgress';
 async request(method:string,params:any) {
  this.calls.push({method,params});
  if(method==='initialize')return {userAgent:'codex/0.170.0'};
  if(method==='thread/start')return {thread:{id:'owned-thread'},model:this.model,cwd:params.cwd,approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false}};
  if(method==='thread/read')return {thread:{id:params.threadId,model:this.model}};
  if(method==='thread/list')return {data:[{id:'external-thread',model:'external-model'}],nextCursor:null};
  if(method==='turn/start')return {turn:{id:'provider-turn',status:this.status}};
  throw Error('UNEXPECTED_RPC');
 }
 notify(method:string,params:any){this.calls.push({method,params});}
 onEvent(listener:(method:string,params:any)=>void){this.listener=listener;return ()=>{};}
 close(){}
}
test('Codex real stdio framing handles official handshake and never grants server requests',async()=>{
 const f=await fixture();let peer:CodexStdio|undefined;try{
 const executable=join(f.root,'protocol-worker.mjs');
 await writeFile(executable,`#!/usr/bin/env node\nimport {createInterface} from 'node:readline';\nconst lines=createInterface({input:process.stdin});for await(const line of lines){const m=JSON.parse(line);if(m.method==='initialize'){process.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'fixture'}})+'\\n');process.stdout.write(JSON.stringify({id:999,method:'item/commandExecution/requestApproval',params:{}})+'\\n');}else if(m.id===999&&m.error){process.stdout.write(JSON.stringify({method:'denial-observed',params:{code:m.error.code}})+'\\n');}}\n`,{mode:0o700});
 peer=new CodexStdio(executable,f.root);
 const denied=new Promise<void>(resolve=>peer!.onEvent((method,params)=>{if(method==='denial-observed'){assert.equal(params.code,-32601);resolve();}}));
 assert.equal((await peer.request('initialize',{},signal())).userAgent,'fixture');await denied;
 }finally{peer?.close();await f.cleanup();}
});
test('Codex observes external sessions without resume; prepare creates only owned threads with effective model checks',async()=>{
 const f=await fixture(),rpc=new OfficialFrames();const driver=new CodexAppServerDriver({executable:'/unused',cwd:f.root,stateDirectory:join(f.root,'state')},rpc);
 try{
 const observed=await driver.inspect(signal());assert.equal(observed[0].ownership,'external');assert.equal(observed[0].available,false);
 assert.ok(!rpc.calls.some(c=>c.method==='thread/start'||c.method==='thread/resume'||c.method==='turn/start'));
 await assert.rejects(driver.execute('external-thread',randomUUID(),'must not send',signal()),/OWNED_SESSION/);
 const managed=await driver.prepare('Hermes','observed-model',signal());assert.equal(managed.modelId,'observed-model');assert.equal(managed.ownership,'managed');
 assert.equal(managed.scopeEnforced,false); // read-only sandbox alone does not prove MCP isolation
 await driver.prepare('Hermes','observed-model',signal());assert.equal(rpc.calls.filter(c=>c.method==='thread/start').length,1);
 rpc.model='changed';assert.equal((await driver.inspect(signal())).find(s=>s.ownership==='managed')!.available,false);
 }finally{driver.close();await f.cleanup();}
});
test('Codex completion needs correlated successful turn event, survives restart, and never resends',async()=>{
 const f=await fixture(),rpc=new OfficialFrames();const options={executable:'/unused',cwd:f.root,stateDirectory:join(f.root,'state')};const driver=new CodexAppServerDriver(options,rpc);
 try{
 await driver.prepare('Analytics','observed-model',signal());const requestId=randomUUID();
 const accepted=await driver.execute('owned-thread',requestId,'request',signal());assert.equal(accepted.turnId,'provider-turn');
 assert.equal(await driver.collect('owned-thread',requestId,signal()),null);
 rpc.listener('turn/completed',{threadId:'other-thread',turn:{id:'provider-turn',status:'completed',items:[]}});
 assert.equal(await driver.collect('owned-thread',requestId,signal()),null);
 rpc.listener('turn/completed',{threadId:'owned-thread',turn:{id:'provider-turn',status:'completed',error:null,items:[{type:'agentMessage',phase:'final_answer',text:JSON.stringify({result:{ok:true},artifacts:[]})}]}});
 assert.deepEqual((await driver.collect('owned-thread',requestId,signal()))!.output,{result:{ok:true},artifacts:[]});
 await assert.rejects(driver.execute('owned-thread',requestId,'request',signal()),/ALREADY_CLAIMED/);
 const restarted=new CodexAppServerDriver(options,new OfficialFrames());
 assert.equal((await restarted.reconcile('owned-thread',requestId,signal()))!.turnId,'provider-turn');
 assert.ok(await restarted.collect('owned-thread',requestId,signal()));restarted.close();
 }finally{driver.close();await f.cleanup();}
});
test('Codex model reroute invalidates execution and cannot produce completion',async()=>{
 const f=await fixture(),rpc=new OfficialFrames(),driver=new CodexAppServerDriver({executable:'/unused',cwd:f.root,stateDirectory:join(f.root,'state')},rpc);
 try{
 await driver.prepare('Hermes','observed-model',signal());const id=randomUUID();await driver.execute('owned-thread',id,'request',signal());
 rpc.listener('model/rerouted',{threadId:'owned-thread'});
 rpc.listener('turn/completed',{threadId:'owned-thread',turn:{id:'provider-turn',status:'completed',items:[{type:'agentMessage',text:'{}'}]}});
 assert.equal(await driver.collect('owned-thread',id,signal()),null);
 }finally{driver.close();await f.cleanup();}
});
function sdkFixture(cwd:string,{wrongCorrelation=false,plainText=false,outputFor}:{wrongCorrelation?:boolean;plainText?:boolean;outputFor?:(prompt:string)=>unknown}={}) {
 const state={queries:0,messages:[] as any[],options:undefined as any};
 const sdk:ClaudeSdk={listSessions:async()=>[{sessionId:'external-sdk-session'}],query:({prompt,options})=>{
 state.queries++;state.options=options;let stopped=false;
 const generator=(async function*(){
 yield {type:'system',subtype:'init',session_id:'owned-sdk-session',model:'observed-model',cwd,permissionMode:'dontAsk',tools:[],mcp_servers:[],plugins:[],capabilities:['interrupt_receipt_v1']};
 for await(const message of prompt){if(stopped)return;state.messages.push(message);
 const correlation=wrongCorrelation?'wrong':message.uuid;
 yield {type:'assistant',uuid:'provider-message-id',session_id:'owned-sdk-session',user_message_uuid:correlation,parent_tool_use_id:null,message:{model:'observed-model',content:[{type:'text',text:'ACK'}]}};
 yield {type:'result',subtype:'success',uuid:'provider-result-id',session_id:'owned-sdk-session',user_message_uuid:correlation,is_error:false,modelUsage:{'observed-model':{}},permission_denials:[],...(plainText?{result:'done'}:{structured_output:outputFor?outputFor(message.message.content):{result:{ok:true},artifacts:[]}})};
 }
 })();return Object.assign(generator,{close:()=>{stopped=true;}});
 }};return {sdk,state};
}
test('Claude uses official SDK streaming input, observes provider init, and correlates user UUID/result',async()=>{
 const f=await fixture(),mock=sdkFixture(f.root),driver=new ClaudeAgentSdkDriver(mock.sdk,{cwd:f.root,stateDirectory:join(f.root,'state')});
 try{
 assert.equal((await driver.inspect(signal()))[0].ownership,'external');assert.equal(mock.state.queries,0);
 await assert.rejects(driver.execute('external-sdk-session',randomUUID(),'request',signal()),/OWNED_SESSION/);
 const observation=await driver.prepare('UE-Pattern','observed-model',signal());assert.equal(observation.modelId,'observed-model');assert.deepEqual(mock.state.messages,[]);
 assert.deepEqual(mock.state.options.tools,[]);assert.equal(mock.state.options.permissionMode,'dontAsk');assert.equal(mock.state.options.resume,undefined);
 const id=randomUUID(),accepted=await driver.execute(observation.sessionId,id,'request',signal());assert.equal(accepted.turnId,'provider-message-id');
 // Let the stream persist its final event.
 for(let i=0;i<50&&!await driver.collect(observation.sessionId,id,signal());i++)await new Promise(r=>setTimeout(r,5));
 const completion=await driver.collect(observation.sessionId,id,signal());assert.ok(completion);assert.deepEqual(completion.output,{result:{ok:true},artifacts:[]});
 await assert.rejects(driver.execute(observation.sessionId,id,'request',signal()));assert.equal(mock.state.messages.length,1);
 }finally{driver.close();await f.cleanup();}
});
for(const config of [{wrongCorrelation:true},{plainText:true}])test(`Claude rejects missing provider correlation/structured result: ${JSON.stringify(config)}`,async()=>{
 const f=await fixture(),mock=sdkFixture(f.root,config),driver=new ClaudeAgentSdkDriver(mock.sdk,{cwd:f.root,stateDirectory:join(f.root,'state')});
 try{const observation=await driver.prepare('Analytics','observed-model',signal()),id=randomUUID();
 await driver.execute(observation.sessionId,id,'request',signal()).catch(()=>{});
 assert.equal(await driver.collect(observation.sessionId,id,signal()),null);
 }finally{driver.close();await f.cleanup();}
});
test('built-in native transport is executable but protocol capabilities alone never unblock registry',async()=>{
 const f=await fixture(),rpc=new OfficialFrames(),keys=generateKeyPairSync('ed25519');
 const driver=new CodexAppServerDriver({executable:'/unused',cwd:f.root,stateDirectory:join(f.root,'state')},rpc);
 const transport=new NativeAgentTransport('native-codex',driver,keys.privateKey,'workspace',new RuntimeJournal(join(f.root,'tasks')));
 const registry=new AgentRuntimeRegistry([transport],[{transportId:transport.id,mode:'live',moduleDigest:'a'.repeat(64),publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()}]);
 try{await transport.prepare('Hermes','observed-model',signal());await registry.refresh();assert.equal(registry.current().length,0);assert.equal(registry.route('PLAN').session,undefined);
 assert.equal((registry.report().observations['native-codex'] as any[])[0].ownership,'managed');
 }finally{transport.close();await f.cleanup();}
});
test('native service initializes private identity and refuses implicit session preparation',async t=>{
 const f=await fixture();let service:Awaited<ReturnType<typeof serveNativeRuntimes>>|undefined;
 const config:NativeServiceConfig={version:1,stateDirectory:f.root,socketPath:join(f.root,'runtime.sock'),workspaceId:'test',providers:[{id:'codex',provider:'codex',executable:'/not-executed',roles:[{agentId:'Analytics',modelId:'model'}]}]};
 try{
 const initialized=await initializeNativeService(config);assert.equal(initialized.adapterConfig,join(f.root,'team-adapters.json'));
 assert.deepEqual(await initializeNativeService(config),initialized);
 try{service=await serveNativeRuntimes(config);}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){t.skip('Sandbox denies local IPC listening');return;}throw e;}
 // Invalid transport is rejected before spawning any runtime.
 await assert.rejects(nativeRequest({id:'unknown',socketPath:config.socketPath,publicKey:'',moduleDigest:''},'prepare',{agentId:'Analytics'},signal()),/SESSION_CREATION_AUTHORIZATION_REQUIRED/);
 }finally{await service?.close();await f.cleanup();}
});
for(const provider of ['codex','claude-code'] as const)test(`native ${provider} adapters connect all team roles through Registry, Router, Dispatcher, Collector and Autopilot`,async()=>{
 const {runMigrationTeam,authorizationTemplate}=await import('../src/autopilot/migration-team.js');
 const {mkdir}=await import('node:fs/promises');const f=await fixture();
 const transports:NativeAgentTransport[]=[],anchors:any[]=[],sent:string[]=[];
 try {
  for(const [agent,capabilities,profile] of [['Migration Orchestrator',['coordination'],'ADVANCED'],['Analytics',['analysis'],'ECONOMY'],['UE-Pattern',['mapping'],'BALANCED'],['Hermes',['planning','coding'],'ADVANCED'],['Validator',['validation'],'BALANCED']] as const) {
   let turns=0;const peer=new OfficialFrames();const original=peer.request.bind(peer);
   const makeOutput=(prompt:string)=>{
    const task=JSON.parse(prompt) as RuntimeTask;sent.push(task.stage);
    const outputKey={ANALYZE:'inventory',DISCOVER_COMPONENTS:'components',MAP_COMPONENTS:'mappings',PLAN:'steps',IMPLEMENT:'files',VALIDATE:'checks'}[task.stage];
    const bytes=Buffer.from(JSON.stringify({version:1,jobId:task.jobId,taskId:task.taskId,stage:task.stage,inputs:task.inputs,[outputKey]:['test output'],limitations:[],passed:true}));
    const file=task.stage+'.output.json';
    return {result:{version:2,jobId:task.jobId,taskId:task.taskId,stage:task.stage,status:'completed',summary:'protocol fixture',evidence:['test']},artifacts:[{file,content:bytes.toString('utf8')}]};
   };
   peer.request=async(method,params)=>{
    if(method!=='turn/start')return original(method,params);
    const turnId='turn-'+(++turns),output=makeOutput(params.input[0].text);
    peer.listener('turn/completed',{threadId:'owned-thread',turn:{id:turnId,status:'completed',error:null,items:[{type:'agentMessage',phase:'final_answer',text:JSON.stringify(output)}]}});
    return {turn:{id:turnId,status:'inProgress'}};
   };
   const state=join(f.root,agent),keys=generateKeyPairSync('ed25519');
   const driver=provider==='codex'?new CodexAppServerDriver({executable:'/unused',cwd:f.root,stateDirectory:join(state,'provider')},peer):
     new ClaudeAgentSdkDriver(sdkFixture(f.root,{outputFor:makeOutput}).sdk,{cwd:f.root,stateDirectory:join(state,'provider')});
   const verifier={verify:async(o:any)=>({sessionId:o.sessionId,connectionId:o.connectionId,modelId:o.modelId,capabilities:[...capabilities],profile,evidenceDigest:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString(),identityVerified:true as const,modelVerified:true as const,capabilitiesVerified:true as const,profileVerified:true as const,scopeEnforced:true as const})};
   const transport=new NativeAgentTransport(agent,driver,keys.privateKey,'test',new RuntimeJournal(join(state,'tasks')),verifier);
   await transport.prepare(agent,'observed-model',signal());transports.push(transport);anchors.push({transportId:agent,mode:'live',moduleDigest:'a'.repeat(64),publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()});
  }
  const registry=new AgentRuntimeRegistry(transports,anchors);await registry.refresh();
  const html='<html><body>Fixture</body></html>',source={jobId:'6c23a49df3f6b1798231',url:'https://banco.bradesco/html/classic/atendimento/atendimento.shtm',html,sha256:bytesDigest(html),historyDigest:'b'.repeat(64)};
  const authorization={...authorizationTemplate(source,registry,'integration'),approvedBy:'test',expiresAt:new Date(Date.now()+60000).toISOString()};
  const history=join(f.root,'history');await mkdir(history);
  const options={source,registry,authorization,runId:'integration',runDirectory:join(f.root,'run'),historicalRoot:history};
  const result=await runMigrationTeam(options);assert.equal(result.completed.length,6);assert.equal(result.state,'awaiting-review');
  await runMigrationTeam(options);assert.deepEqual(sent,['ANALYZE','DISCOVER_COMPONENTS','MAP_COMPONENTS','PLAN','IMPLEMENT','VALIDATE']);
 }finally{for(const transport of transports)transport.close();await f.cleanup();}
});
