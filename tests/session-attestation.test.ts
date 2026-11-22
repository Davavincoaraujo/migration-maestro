import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requestSessionAttestation, isCurrentSessionAttestation, sessionBindingDigest, type SessionAttestationProvider, type SessionExpectation } from '../src/sessions/session-attestation.js';
import { maestriSessionAttestationProvider } from '../src/integrations/maestri-session-attestation.js';
import { operationalSessionGate } from '../src/integrations/operational-session-attestation.js';
import { syntheticSessionAttestation, syntheticSessionAttestationProvider } from './fixtures/operational-agent.js';
import { selectVerifiedOperationalPlan, type AgentDeclaration } from '../src/ai/operational-routing.js';
import { centralStageRoutes } from '../src/integrations/maestri-model-router.js';
const expected:SessionExpectation={agentId:'Hermes',provider:'codex',modelId:'gpt-6-astra',profile:'ADVANCED',capability:'planning'};
const agent:AgentDeclaration={agentId:'Hermes',mode:'declared',provider:'codex',modelId:'gpt-6-astra',capabilities:['planning','coding']};
const request=centralStageRoutes.PLAN.request;
const mutated=(edit:(v:any)=>void):SessionAttestationProvider=>({id:'test-session-provider',async attest(r){const v=syntheticSessionAttestation(r);edit(v);return v;}});

test('default CLI provider never attests identities, models or capabilities from names/footer-shaped text',async()=>{
  for(const [text,reason] of [['name: "Hermes"','MAESTRI_SESSION_ATTESTATION_UNSUPPORTED'],['name: "Other"','MAESTRI_AGENT_NOT_OBSERVED'],['name: "Hermes"\nname: "Hermes"','MAESTRI_AGENT_AMBIGUOUS'],['name: "Hermes"\nGPT-6-astra high · ADVANCED planning available','MAESTRI_SESSION_ATTESTATION_UNSUPPORTED']]) {
    const commands:string[]=[];
    const p=maestriSessionAttestationProvider(async(c)=>{commands.push(c);return text;});
    assert.deepEqual(await requestSessionAttestation(p,expected),{status:'unverified',reason});assert.deepEqual(commands,['list']);
  }
});
test('unavailable Maestri, provider exceptions, malformed replies and timeout fail closed',async()=>{
  assert.deepEqual(await requestSessionAttestation(maestriSessionAttestationProvider(async()=>{throw Error('secret transport details');}),expected),{status:'unverified',reason:'MAESTRI_UNAVAILABLE'});
  for(const value of [undefined,null,{},[],{status:'verified'},{status:'unverified',reason:'secret/path'}]) {
    assert.equal((await requestSessionAttestation({id:'test',async attest(){return value;}},expected)).status,'unverified');
  }
  assert.equal((await requestSessionAttestation({id:'test',async attest(){throw Error('secret');}},expected)).status,'unverified');
  let aborted=false;
  assert.equal((await requestSessionAttestation({id:'test',attest(_r,signal){signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}},expected,{timeoutMs:5})).status,'unverified');
  assert.equal(aborted,true);
});
const cases:Record<string,(v:any)=>void>={
  'missing session':v=>delete v.binding.sessionId,
  'wrong agent':v=>v.binding.agentId='Analytics',
  'incompatible model':v=>v.binding.modelId='gpt-other',
  'wrong provider':v=>v.binding.provider='claude-code',
  'economy':v=>v.binding.profile='ECONOMY',
  'balanced':v=>v.binding.profile='BALANCED',
  'no planning':v=>v.binding.capabilities=['coding'],
  'unavailable':v=>v.binding.available=false,
  'identity unverified':v=>v.evidence.identityVerified=false,
  'capability merely declared':v=>v.evidence.capabilitiesVerified=false,
  'profile merely configured':v=>v.evidence.profileVerified=false,
  'model merely observed':v=>v.evidence.modelVerified=false,
  'availability unknown':v=>v.evidence.availabilityVerified=false,
  'missing workspace':v=>delete v.binding.workspaceId,
  'missing terminal':v=>delete v.binding.terminalId,
  'missing evidence':v=>delete v.evidence.reference,
  'expired':v=>v.expiresAt='2000-01-01T00:00:00Z',
  'historical observation':v=>v.issuedAt='2000-01-01T00:00:00Z',
  'future observation':v=>v.issuedAt='2999-01-01T00:00:00Z',
  'excessive TTL':v=>v.expiresAt='2999-01-01T00:00:00Z',
  'wrong challenge':v=>v.challenge='old-challenge',
  'wrong issuer':v=>v.issuer='other-provider',
  'digest mismatch':v=>v.evidence.bindingDigest='0'.repeat(64),
};
for(const [name,edit] of Object.entries(cases)) test('rejects '+name,async()=>{
  const r=await requestSessionAttestation(mutated(edit),expected);assert.equal(r.status,'unverified');
  await assert.rejects(operationalSessionGate(mutated(edit))(agent,request),/VERIFIED_ADVANCED/);
});
test('valid simulated attestation binds session and capability; raw/cloned JSON is not router authority',async()=>{
  const r=await requestSessionAttestation(syntheticSessionAttestationProvider,expected);assert.equal(r.status,'verified');
  if(r.status!=='verified')throw Error('fixture');
  assert.equal(isCurrentSessionAttestation(r),true);assert.equal(isCurrentSessionAttestation(r,Date.parse(r.expiresAt)),false);
  const decision=selectVerifiedOperationalPlan(agent,r,{...request,signals:{taskKind:'read',technicalRisk:'low'}});
  assert.equal(decision.profile,'ADVANCED');assert.equal(decision.agentId,'Hermes');
  assert.equal(decision.operationalEvidence.deliveryAuthenticated,false);
  assert.throws(()=>selectVerifiedOperationalPlan(agent,structuredClone(r),request),/VERIFIED_ADVANCED/);
  assert.throws(()=>{r.binding.sessionId='changed';},TypeError);
  assert.throws(()=>{r.binding.capabilities.push('anything');},TypeError);
});
test('challenge replay and session switching across gate checks are rejected',async()=>{
  let saved:unknown;
  const replay:SessionAttestationProvider={id:'test-session-provider',async attest(r){return saved??(saved=syntheticSessionAttestation(r));}};
  assert.equal((await requestSessionAttestation(replay,expected)).status,'verified');
  assert.equal((await requestSessionAttestation(replay,expected)).status,'unverified');
  let n=0;const gate=operationalSessionGate(mutated(v=>{v.binding.sessionId='session-'+n++;v.evidence.bindingDigest=sessionBindingDigest(v.binding);}));
  await gate(agent,request);await assert.rejects(gate(agent,request),/BINDING_CHANGED/);
});
test('persisted PLAN intent pins session across process restarts; historical attestation is never reused as authority',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'session-pin-'));
  try {
    const decision=await operationalSessionGate(syntheticSessionAttestationProvider)(agent,request);
    await writeFile(join(dir,'PLAN.route.json'),JSON.stringify({selected:decision}));
    await writeFile(join(dir,'PLAN.task.json'),'{}');
    await operationalSessionGate(syntheticSessionAttestationProvider,dir)(agent,request);
    const changed=mutated(v=>{v.binding.sessionId='another';v.evidence.bindingDigest=sessionBindingDigest(v.binding);});
    await assert.rejects(operationalSessionGate(changed,dir)(agent,request),/BINDING_CHANGED/);
    await assert.rejects(operationalSessionGate(maestriSessionAttestationProvider(async()=> 'name: "Hermes"'),dir)(agent,request),/VERIFIED_ADVANCED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
