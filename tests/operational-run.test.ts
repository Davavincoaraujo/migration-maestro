import { syntheticSessionAttestationProvider } from './fixtures/operational-agent.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { runOperational, readOperationalJson } from '../src/autopilot/operational-run.js';
import type { MaestriTransport } from '../src/integrations/maestri-central-cli.js';
import { validateOperationalPolicy } from '../src/ai/operational-routing.js';
const hash = (v:string) => createHash('sha256').update(v).digest('hex');
const policy = validateOperationalPolicy(JSON.parse(await readFile('config/operational-agents.json','utf8')));
const id = 'a'.repeat(20);
async function harness(mode: 'normal'|'ack'|'timeout'|'invalid'|'unavailable' = 'normal') {
  const directory = await mkdtemp(join(tmpdir(),'operational-'));
  const root = join(directory,id); let sends = 0; let delayed: (() => Promise<void>) | undefined;
  const transport: MaestriTransport = async (cmd,args) => {
    if (cmd === 'list') { if (mode === 'unavailable') throw Error('MAESTRI_COMMAND_FAILED'); return 'Connected agents:\n - name: "Analytics"\n - name: "UE-Pattern"\n - name: "Hermes"\nConnected portals:'; }
    if (cmd === 'check') return 'private history, not evidence';
    sends++;
    if (args[1].includes('isolated capability task')) {
      if (mode === 'ack') return 'ACK';
      const path = args[1].match(/Work ONLY in (.+)\./)![1];
      const task = await readOperationalJson(join(path,'CAPABILITY.task.json'));
      await writeFile(join(path,'capability.json'),JSON.stringify({ version:1,jobId:path.split('/').at(-1),taskId:task.taskId,nonce:task.nonce,
        analysis:{componentCount:mode === 'invalid' ? 9 : 2},mapping:{hero:'demo/components/hero',text:'demo/components/text'},
        planning:['analyze','map','implement','validate'],coding:'export const componentCount = 2;',validation:['broken'] }));
      return 'ACK';
    }
    const file = args[1].match(/Write a JSON result file at (.+) with taskId equal to/)![1];
    const task = await readOperationalJson(join(dirname(file),'ANALYZE.task.json'));
    const deliver = async () => {
      const bytes = JSON.stringify({ version:1,componentCount:2,resourceTypes:['demo/components/hero','demo/components/text'],missingResourceTypeIds:['broken'] });
      await writeFile(join(root,'inventory.json'),bytes);
      await writeFile(file,JSON.stringify({ version:2,jobId:id,taskId:task.taskId,stage:'ANALYZE',status:'completed',summary:'Synthetic inventory',evidence:['Counted two valid components'],artifacts:[{ file:'inventory.json',digest:hash(bytes) }] }));
    };
    if (mode === 'timeout') { delayed = deliver; throw Error('MAESTRI_TIMEOUT'); }
    await deliver(); return 'private terminal conversation';
  };
  return { directory,root,transport,sends:()=>sends,deliver:()=>delayed!(), cleanup:()=>rm(directory,{recursive:true,force:true}),
    run:()=>runOperational({ directory,id,kind:'task',policy,confirmed:true,transport,pollMs:0 }) };
}
test('isolated vertical flow persists artifacts/checkpoint, separates simulation, and resumes without duplicate sends', async () => {
  const f = await harness();
  try {
    const first = await f.run(); assert.equal(first.status,'awaiting-approval'); assert.equal(first.executionMode,'simulated'); assert.equal(first.realAcceptanceVerified,false);
    assert.equal(f.sends(),2); const before = await readFile(join(f.root,`${id}.checkpoint.json`),'utf8');
    await f.run(); assert.equal(f.sends(),2); assert.equal(await readFile(join(f.root,`${id}.checkpoint.json`),'utf8'),before);
    const route = await readOperationalJson(join(f.root,'ANALYZE.route.json'));
    assert.equal(route.selected.operationalEvidence.availability,'unknown');
    assert.doesNotMatch(await readFile(join(f.root,'ANALYZE.ask.log'),'utf8'),/private/);
    await writeFile(join(f.root,'inventory.json'),'{}');
    assert.equal((await f.run()).status,'failed'); assert.equal(f.sends(),2);
  } finally { await f.cleanup(); }
});
test('ACK is not capability completion and repeated resume never repeats a probe', async () => {
  const f = await harness('ack');
  try { assert.equal((await f.run()).status,'pending'); await f.run(); assert.equal(f.sends(),1); }
  finally { await f.cleanup(); }
});
test('ambiguous agent delivery accepts a late hash-bound result without resend', async () => {
  const f = await harness('timeout');
  try {
    assert.equal((await f.run()).status,'pending'); await f.run(); assert.equal(f.sends(),2);
    await f.deliver(); assert.equal((await f.run()).status,'awaiting-approval'); assert.equal(f.sends(),2);
  } finally { await f.cleanup(); }
});
test('wrong capability and unavailable Maestri block task dispatch', async () => {
  for (const mode of ['invalid','unavailable'] as const) {
    const f = await harness(mode);
    try { const result=await f.run(); assert.ok(['failed','blocked'].includes(result.status)); assert.equal(f.sends(),mode==='invalid'?1:0); }
    finally { await f.cleanup(); }
  }
});
test('no confirmation, changed policy, and stale lock fail closed', async () => {
  const f = await harness();
  try {
    await assert.rejects(runOperational({ directory:f.directory,id,kind:'task',policy,confirmed:false,transport:f.transport }),/CONFIRMATION/);
    await f.run();
    const changed = await runOperational({ directory:f.directory,id,kind:'task',policy:{...policy,maxRisk:'LOW'},confirmed:true,transport:f.transport });
    assert.equal(changed.status,'failed'); assert.equal(f.sends(),2);
    await writeFile(join(f.directory,'operation.lock'),'operator reconciliation required');
    await assert.rejects(f.run(),/LOCKED/);
  } finally { await f.cleanup(); }
});

test('pipeline blocks session-required PLAN despite synthetic attestation and never resends on resume', async () => {
  const { syntheticOperationalAgent } = await import('./fixtures/operational-agent.js');
  const directory = await mkdtemp(join(tmpdir(),'operational-pipeline-'));
  const calls:string[]=[];
  const options = { directory,id,kind:'pipeline' as const,policy,sessionAttestationProvider:syntheticSessionAttestationProvider,confirmed:true,transport:syntheticOperationalAgent(calls),pollMs:0 };
  try {
    for(let i=0;i<2;i++) {
      const result=await runOperational(options);
      assert.equal(result.status,'blocked');
      assert.equal('reason' in result && result.reason,'MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED');
      assert.equal(calls.filter(c=>c.startsWith('ask:')).length,4);
      for(const stage of ['PLAN','IMPLEMENT']) await assert.rejects(readFile(join(directory,id,stage+'.task.json')),{code:'ENOENT'});
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('local human review is hash-bound and idempotent without upgrading simulation', async () => {
  const { reviewOperational } = await import('../src/autopilot/operational-run.js');
  const f=await harness();
  try {
    await assert.rejects(reviewOperational(f.directory,id,'operator'));
    await f.run();
    const reviewed=await reviewOperational(f.directory,id,'operator');
    assert.equal(reviewed.status,'completed'); assert.equal(reviewed.realAcceptanceVerified,false);
    assert.equal(reviewed.review.publicationAuthorized,false);
    assert.deepEqual(await reviewOperational(f.directory,id,'operator'),reviewed);
    await writeFile(join(f.root,'inventory.json'),'{}');
    await assert.rejects(reviewOperational(f.directory,id,'operator'),/CHANGED/);
    assert.equal(f.sends(),2);
  } finally {await f.cleanup();}
});

test('Next workflow also blocks PLAN without a session-bound transport', async () => {
  const { syntheticOperationalAgent } = await import('./fixtures/operational-agent.js');
  const directory=await mkdtemp(join(tmpdir(),'operational-next-')),calls:string[]=[];
  const options={directory,id,kind:'next' as const,policy,sessionAttestationProvider:syntheticSessionAttestationProvider,confirmed:true,transport:syntheticOperationalAgent(calls),pollMs:0};
  try {
    // This fixture lacks the additional Next inventory, so supply the documented artifact.
    const base=options.transport;
    options.transport=async(cmd,args)=>{
      const response=await base(cmd,args);
      if(cmd==='ask' && args[1].includes('; stage ANALYZE.')) {
        await writeFile(join(directory,id,'ANALYZE.inventory.json'),JSON.stringify({version:1,scope:'synthetic-only',heading:'Explore the imaginary garden',cta:'Discover the garden',requirements:['semantic hero'],limitations:['browser unverified']}));
      }
      return response;
    };
    const planned=await runOperational({...options,pauseAfter:'PLAN'});
    assert.equal(planned.status,'blocked');
    const resumed=await runOperational(options);
    assert.equal(resumed.status,'blocked');
    assert.equal('reason' in resumed && resumed.reason,'MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED');
    assert.equal(calls.filter(c=>c.startsWith('ask:')).length,4);
    await assert.rejects(readFile(join(directory,id,'PLAN.task.json')),{code:'ENOENT'});
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('completed work resumes offline and corrupt capability artifacts cannot be reused', async () => {
  const f=await harness();
  try {
    await f.run();
    const offline = await runOperational({directory:f.directory,id,kind:'task',policy,confirmed:true,transport:async()=>{throw Error('NETWORK_MUST_NOT_BE_CALLED');},pollMs:0});
    assert.equal(offline.status,'awaiting-approval');
    const probeId=hash('Analytics').slice(0,20);
    await writeFile(join(f.root,'probes',probeId,'capability.json'),'{}');
    const changed=await f.run(); assert.equal(changed.status,'failed'); assert.equal(f.sends(),2);
  } finally {await f.cleanup();}
});

test('ambiguous duplicate connected names cannot trigger a capability probe or task', async () => {
  const f=await harness();
  try {
    const result=await runOperational({directory:f.directory,id,kind:'task',policy,confirmed:true,pollMs:0,transport:async(cmd)=>cmd==='list'?'name: "Analytics"\nname: "Analytics"':'no metadata'});
    assert.equal(result.status,'blocked'); assert.equal('reason' in result && result.reason,'AMBIGUOUS_AGENT_NAME');
    assert.equal(f.sends(),0);
  } finally {await f.cleanup();}
});

test('plan-only authorization persists and cannot be removed to reach IMPLEMENT', async () => {
  const { syntheticOperationalAgent } = await import('./fixtures/operational-agent.js');
  const directory=await mkdtemp(join(tmpdir(),'plan-only-')), calls:string[]=[];
  const options={directory,id,kind:'pipeline' as const,policy,sessionAttestationProvider:syntheticSessionAttestationProvider,confirmed:true,planOnly:true,transport:syntheticOperationalAgent(calls),pollMs:0};
  try {
    const planned=await runOperational(options);
    assert.equal(planned.status,'blocked');
    assert.equal('reason' in planned && planned.reason,'MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED');
    const sends=calls.filter(c=>c.startsWith('ask:')).length;
    assert.equal(sends,4);
    await assert.rejects(runOperational(options)); // Existing plan-only runs require recovery and explicit authorization.
    assert.equal(calls.filter(c=>c.startsWith('ask:')).length,sends);
    await assert.rejects(runOperational({...options,planOnly:false}),/OPERATION_INPUT_CHANGED/);
    await assert.rejects(readFile(join(directory,id,'IMPLEMENT.task.json')), {code:'ENOENT'});
    await assert.rejects(readFile(join(directory,id,'VALIDATE.task.json')), {code:'ENOENT'});
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('plan-only stops on ambiguous probe or stage even when a result was written', async () => {
  const { syntheticOperationalAgent } = await import('./fixtures/operational-agent.js');
  for (const target of ['probe','stage']) {
    const directory=await mkdtemp(join(tmpdir(),'plan-ambiguous-')),calls:string[]=[];
    const base=syntheticOperationalAgent(calls);
    const transport:MaestriTransport=async(cmd,args)=>{
      const result=await base(cmd,args);
      if(cmd==='ask' && (target==='probe' ? args[1].includes('isolated capability task') : args[1].includes('; stage ANALYZE.'))) throw Error('MAESTRI_TIMEOUT');
      return result;
    };
    try {
      const result=await runOperational({directory,id,kind:'pipeline',policy,confirmed:true,planOnly:true,transport,pollMs:0});
      assert.equal(result.status,'blocked');
      assert.equal('reason' in result && result.reason,'AMBIGUOUS_DISPATCH_RECONCILIATION_REQUIRED');
      assert.equal(calls.filter(c=>c.startsWith('ask:')).length,target==='probe'?1:2);
      await assert.rejects(readFile(join(directory,id,'MAP_COMPONENTS.task.json')), {code:'ENOENT'});
    } finally {await rm(directory,{recursive:true,force:true});}
  }
});
