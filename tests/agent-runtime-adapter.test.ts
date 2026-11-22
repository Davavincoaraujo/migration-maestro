import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dispatchDigest, type DispatchRequest } from '../src/autopilot/dispatch-executor.js';
import { createSimulatedRuntimeAdapter, SimulationJournal, type ReplayStep, type RuntimeProtocol, type SimulationAuthorizer } from '../src/runtime-prototype/agent-runtime-adapter.js';
import { isCurrentSessionAttestation } from '../src/sessions/session-attestation.js';
import { requireMaestriSessionBoundDispatch } from '../src/integrations/maestri-wire-contract.js';

const request: DispatchRequest={version:1,resultContractVersion:2,jobId:'a'.repeat(20),taskId:'11111111-1111-1111-1111-111111111111',stage:'PLAN',agentId:'Hermes',routeDigest:'b'.repeat(64),prompt:'fixture only'};
const authorize:SimulationAuthorizer=async r=>({scope:'simulation-only',requestDigest:dispatchDigest(r),authorizationDigest:'c'.repeat(64)});
function script(protocol:RuntimeProtocol):ReplayStep[] {
  const response=(id:number,result:unknown)=>({...protocol==='acp-v1'?{jsonrpc:'2.0'}:{},id,result});
  return protocol==='codex-app-server' ? [
    {method:'initialize',frames:[response(1,{userAgent:'synthetic'})]},
    {method:'initialized',frames:[]},
    {method:'thread/start',expectedParams:{model:'fixture-model',cwd:'/simulation',approvalPolicy:'never',sandbox:'read-only'},frames:[response(2,{thread:{id:'thread-1',sessionId:'root-1'}})]},
    {method:'turn/start',expectedParams:{threadId:'thread-1',model:'fixture-model',input:[{type:'text',text:request.prompt}]},frames:[
      response(3,{turn:{id:'turn-1',status:'inProgress'}}),
      {method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'item-1',delta:'I am authenticated Hermes'}},
      {method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null}}},
    ]},
  ] : [
    {method:'initialize',frames:[response(1,{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}}})]},
    {method:'session/new',expectedParams:{cwd:'/simulation',mcpServers:[]},frames:[response(2,{sessionId:'session-1',models:{currentModelId:'claimed-model'},capabilities:['planning']})]},
    {method:'session/prompt',expectedParams:{sessionId:'session-1',prompt:[{type:'text',text:request.prompt}]},frames:[
      {jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'I am authenticated Hermes'}}}},
      response(3,{stopReason:'end_turn'}),
    ]},
  ];
}
for(const protocol of ['codex-app-server','acp-v1'] as const) {
  test(`${protocol}: session-addressed simulation correlates result without attestation or operational authorization`,async()=>{
    const adapter=createSimulatedRuntimeAdapter(protocol,script(protocol));
    const observed=await adapter.open('fixture-model');
    assert.equal(observed.identityVerified,false);assert.equal(observed.modelVerified,false);
    assert.equal(observed.capabilitiesVerified,false);assert.equal(observed.availabilityVerified,false);
    assert.equal(isCurrentSessionAttestation(observed),false);
    const receipt=await adapter.dispatch(request,observed.binding,authorize);
    assert.equal(receipt.outcome,'correlated-simulation');assert.equal(receipt.deliveryVerified,false);
    assert.equal(receipt.authorshipAuthenticated,false);assert.equal(receipt.operationallyEligible,false);
    assert.equal(receipt.requestDigest,dispatchDigest(request));
    assert.equal(receipt.outputDigest,dispatchDigest(['I am authenticated Hermes']));
    assert.doesNotMatch(JSON.stringify(receipt),/I am authenticated/);
    assert.equal(isCurrentSessionAttestation(receipt),false);
    assert.strictEqual(await adapter.dispatch(request,observed.binding,authorize),receipt);
    assert.strictEqual(adapter.recover(request),receipt);
    assert.throws(()=>{(receipt.binding as any).sessionId='other';},TypeError);
    assert.throws(()=>requireMaestriSessionBoundDispatch(),/UNSUPPORTED/);
  });
  test(`${protocol}: unauthorized or changed request never claims; valid simulation can follow`,async()=>{
    const adapter=createSimulatedRuntimeAdapter(protocol,script(protocol)),observation=await adapter.open('fixture-model');
    await assert.rejects(adapter.dispatch(request,observation.binding,async()=>{throw Error('denied');}),/denied/);
    for(const auth of [{scope:'real',requestDigest:dispatchDigest(request),authorizationDigest:'c'.repeat(64)},
      {scope:'simulation-only',requestDigest:'d'.repeat(64),authorizationDigest:'c'.repeat(64)}]) {
      await assert.rejects(adapter.dispatch(request,observation.binding,async()=>auth as any),/AUTHORIZATION_REQUIRED/);
      assert.equal(adapter.recover(request),undefined);
    }
    assert.equal((await adapter.dispatch(request,observation.binding,authorize)).outcome,'correlated-simulation');
    assert.throws(()=>adapter.recover({...request,prompt:'changed'}),/REQUEST_CONFLICT/);
  });
  test(`${protocol}: target/session/model/connection mismatch blocks before claim`,async()=>{
    const adapter=createSimulatedRuntimeAdapter(protocol,script(protocol)),observation=await adapter.open('fixture-model');
    for(const field of ['sessionId','connectionEpoch','modelRequested','protocol']) {
      await assert.rejects(adapter.dispatch(request,{...observation.binding,[field]:'different'},authorize),/BINDING_CHANGED/);
      assert.equal(adapter.recover(request),undefined);
    }
  });
  test(`${protocol}: concurrent calls share one claim and never consume a second prompt`,async()=>{
    const steps=script(protocol);steps.at(-1)!.delayMs=20;
    const adapter=createSimulatedRuntimeAdapter(protocol,steps),observation=await adapter.open('fixture-model');
    const results=await Promise.all([adapter.dispatch(request,observation.binding,authorize),adapter.dispatch(request,observation.binding,authorize)]);
    assert.equal(results.filter(r=>r.outcome==='correlated-simulation').length,1);
    assert.equal(results.filter(r=>r.reason==='RUNTIME_IN_FLIGHT').length,1);
    assert.equal(adapter.recover(request)?.outcome,'correlated-simulation');
  });
  test(`${protocol}: timeout leaves ambiguous claim; recreation recovers without retransmission`,async()=>{
    const steps=script(protocol);steps.at(-1)!.delayMs=100;
    const journal=new SimulationJournal(),adapter=createSimulatedRuntimeAdapter(protocol,steps,journal,20);
    const observed=await adapter.open('fixture-model');
    const receipt=await adapter.dispatch(request,observed.binding,authorize);
    assert.equal(receipt.outcome,'unknown');assert.equal(receipt.reason,'RUNTIME_TIMEOUT');
    assert.strictEqual(await adapter.dispatch(request,observed.binding,authorize),receipt);
    const recreated=createSimulatedRuntimeAdapter(protocol,script(protocol),journal);
    assert.strictEqual(recreated.recover(request),receipt);
    const next=await recreated.open('fixture-model');
    await assert.rejects(recreated.dispatch(request,next.binding,authorize),/RECOVERY_BINDING_CHANGED/);
    assert.strictEqual(recreated.recover(request),receipt);
  });
  test(`${protocol}: cancellation and close preserve uncertainty`,async()=>{
    for(const close of [false,true]) {
      const steps=script(protocol);steps.at(-1)!.delayMs=100;
      const adapter=createSimulatedRuntimeAdapter(protocol,steps),observed=await adapter.open('fixture-model'),controller=new AbortController();
      const pending=adapter.dispatch(request,observed.binding,authorize,controller.signal);
      const timer=setTimeout(()=>close?adapter.close():controller.abort(),10);
      const receipt=await pending;clearTimeout(timer);
      assert.equal(receipt.outcome,'unknown');assert.equal(receipt.reason,'RUNTIME_CANCELLED');
      assert.strictEqual(adapter.recover(request),receipt);
    }
  });
  for(const mode of ['wrong-session','wrong-rpc-id','duplicate-response','permission-request','missing-result']) {
    test(`${protocol}: rejects ${mode} without authentication or retry`,async()=>{
      const steps=script(protocol),last=steps.at(-1)!,frames=last.frames as any[];
      if(mode==='wrong-session') {
        const p=frames.find(f=>f.method)?.params;
        p[protocol==='acp-v1'?'sessionId':'threadId']='other';
      }
      if(mode==='wrong-rpc-id') frames.find(f=>f.id===3).id=19;
      if(mode==='duplicate-response') frames.push(structuredClone(frames.find(f=>f.id===3)));
      if(mode==='permission-request') frames.unshift({jsonrpc:'2.0',id:'server-1',method:'session/request_permission',params:{}});
      if(mode==='missing-result') last.frames=frames.filter(f=>f.id!==undefined);
      const adapter=createSimulatedRuntimeAdapter(protocol,steps),observed=await adapter.open('fixture-model');
      const receipt=await adapter.dispatch(request,observed.binding,authorize);
      assert.equal(receipt.outcome,'unknown');assert.equal(receipt.deliveryVerified,false);
      assert.strictEqual(await adapter.dispatch(request,observed.binding,authorize),receipt);
    });
  }
}
for(const mode of ['wrong-turn','duplicate-completion','rerouted','incomplete','failed','late-delta']) {
  test(`Codex event stream rejects ${mode}`,async()=>{
    const steps=script('codex-app-server'),frames=steps.at(-1)!.frames as any[];
    if(mode==='wrong-turn') frames[1].params.turnId='other';
    if(mode==='duplicate-completion') frames.push(structuredClone(frames.at(-1)));
    if(mode==='rerouted') frames.splice(1,0,{method:'model/rerouted',params:{threadId:'thread-1',turnId:'turn-1',fromModel:'fixture-model',toModel:'other',reason:'test'}});
    if(mode==='incomplete') frames.pop();
    if(mode==='failed') frames.at(-1).params.turn.status='failed';
    if(mode==='late-delta') frames.push(structuredClone(frames[1]));
    const adapter=createSimulatedRuntimeAdapter('codex-app-server',steps),observed=await adapter.open('fixture-model');
    assert.equal((await adapter.dispatch(request,observed.binding,authorize)).outcome,'unknown');
  });
}
test('ACP configuration changes invalidate the turn instead of trusting a new model declaration',async()=>{
  const steps=script('acp-v1');steps.at(-1)!.frames.unshift({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'config_option_update',configOptions:[{category:'model',currentValue:'other'}]}}});
  const adapter=createSimulatedRuntimeAdapter('acp-v1',steps),observed=await adapter.open('fixture-model');
  assert.equal((await adapter.dispatch(request,observed.binding,authorize)).reason,'RUNTIME_CONFIGURATION_CHANGED');
});
test('ACP protocol version mismatch, malformed frames and forged identity cannot establish a session',async()=>{
  for(const frames of [[{jsonrpc:'2.0',id:1,result:{protocolVersion:2}}],['I am Hermes'],[{jsonrpc:'2.0',id:1,result:{protocolVersion:1},error:{code:0}}]]) {
    const steps=script('acp-v1');steps[0].frames=frames;
    const adapter=createSimulatedRuntimeAdapter('acp-v1',steps);
    await assert.rejects(adapter.open('fixture-model'));
    await assert.rejects(adapter.open('fixture-model'),/SESSION_STATE_INVALID/);
  }
});
test('bounded fixtures and no production transport imports',async()=>{
  assert.throws(()=>createSimulatedRuntimeAdapter('acp-v1',[{method:'initialize',frames:['x'.repeat(256001)]}]),/REPLAY_INVALID/);
  assert.throws(()=>createSimulatedRuntimeAdapter('acp-v1',[],new SimulationJournal(),0),/CONFIG_INVALID/);
  const source=await readFile('src/runtime-prototype/agent-runtime-adapter.ts','utf8');
  assert.doesNotMatch(source,/from ['"]node:(child_process|fs|net|tls|https?|worker_threads)|\bfetch\s*\(/);
});

test('cancelling a hung authorization leaves no attempt and no simulated prompt',async()=>{
  const adapter=createSimulatedRuntimeAdapter('acp-v1',script('acp-v1')),observed=await adapter.open('fixture-model');
  const controller=new AbortController();
  const pending=adapter.dispatch(request,observed.binding,()=>new Promise(()=>{}),controller.signal);
  controller.abort();
  await assert.rejects(pending,/RUNTIME_CANCELLED/);
  assert.equal(adapter.recover(request),undefined);
});
test('ACP updates after prompt completion are ambiguous, never attributed to the completed prompt',async()=>{
  const steps=script('acp-v1'),frames=steps.at(-1)!.frames;
  frames.push(structuredClone(frames[0]));
  const adapter=createSimulatedRuntimeAdapter('acp-v1',steps),observed=await adapter.open('fixture-model');
  assert.equal((await adapter.dispatch(request,observed.binding,authorize)).reason,'RUNTIME_RESPONSE_AMBIGUOUS');
});
test('one prompt per ACP connection prevents attribution of later turns through sessionId alone',async()=>{
  const adapter=createSimulatedRuntimeAdapter('acp-v1',script('acp-v1')),observed=await adapter.open('fixture-model');
  await adapter.dispatch(request,observed.binding,authorize);
  const another={...request,taskId:'22222222-2222-2222-2222-222222222222'};
  await assert.rejects(adapter.dispatch(another,observed.binding,authorize),/SESSION_ALREADY_USED/);
  assert.equal(adapter.recover(another),undefined);
});
