import { requestSessionAttestation, sessionBindingDigest } from '../src/sessions/session-attestation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOperationalRoute, validateOperationalPolicy, type OperationalPolicy } from '../src/ai/operational-routing.js';
const policy: OperationalPolicy = { version:1,scope:'isolated-synthetic',maxRisk:'MEDIUM',agents:[{ agentId:'Analytics',mode:'declared',provider:'codex',modelId:'gpt-6.1-sol',capabilities:['analysis'] }] };
const now = Date.parse('2026-11-17T20:00:00Z');
const input = { policy,agentId:'Analytics',connected:true,confirmed:true,now,
  request:{ taskType:'analysis',capability:'analysis',signals:{ technicalRisk:'low' as const } },
  proof:{ agentId:'Analytics',capabilities:['analysis'],checkedAt:new Date(now).toISOString(),artifactDigest:'a'.repeat(64),taskId:'b'.repeat(36) } };
test('declared model is operationally eligible without fabricated availability or identity', () => {
  const route = selectOperationalRoute(input);
  assert.equal(route.action,'agent');
  const evidence = route.operationalEvidence as any;
  assert.equal(evidence.mode,'declared'); assert.equal(evidence.modelObserved,false);
  assert.equal(evidence.identityVerified,false); assert.equal(evidence.availabilityVerified,false);
  assert.equal(evidence.availability,'unknown'); assert.equal(evidence.operationallyEligible,true);
});
test('configuration alone, expired proof, unavailable connection and unknown costs cannot dispatch', () => {
  for (const patch of [{ proof:undefined },{ connected:false },{ confirmed:false },
    { proof:{ ...input.proof,checkedAt:'2026-11-15T20:00:00Z' } },
    { proof:{ ...input.proof,checkedAt:'2026-11-18T20:00:00Z' } },
    { proof:{ ...input.proof,capabilities:['coding'] } },
    { request:{ ...input.request,maxEstimatedCostUsd:1 } },
    { request:{ ...input.request,excludedAgentIds:['Analytics'] } }]) assert.equal(selectOperationalRoute({ ...input,...patch }).action,'blocked');
});
test('fallback with unknown model permits only explicit low-risk synthetic work', () => {
  const fallback: OperationalPolicy = { ...policy,agents:[{ ...policy.agents[0],mode:'fallback',modelId:null,provider:'unknown' }] };
  const result = selectOperationalRoute({ ...input,policy:fallback });
  assert.equal(result.action,'agent'); assert.equal(result.modelId,'unknown');
  assert.equal(selectOperationalRoute({ ...input,policy:fallback,request:{ ...input.request,signals:{ affectedFiles:4 } } }).action,'blocked');
  assert.throws(() => validateOperationalPolicy({ ...policy,scope:'corporate' }));
  assert.throws(() => validateOperationalPolicy({ ...policy,agents:[policy.agents[0],policy.agents[0]] }));
});
test('high and critical tasks never downgrade or rely on declared models', () => {
  for (const signals of [{ securityCritical:true },{ businessCritical:true },{ technicalRisk:'high' as const, reasoningNeed:'high' as const }]) {
    assert.equal(selectOperationalRoute({ ...input,request:{ ...input.request,signals } }).reason,'HUMAN_APPROVAL_AND_VERIFIABLE_EVIDENCE_REQUIRED');
  }
});
test('generic routing consumes only fresh validated provider attestations', async () => {
  const attestation=await requestSessionAttestation({id:'test-provider',async attest(r){
    const binding={agentId:'Analytics',workspaceId:'test-workspace',terminalId:'test-terminal',sessionId:'test-session',provider:'codex',modelId:'gpt-6.1-sol',profile:'BALANCED',capabilities:['analysis'],available:true} as const;
    return {version:1,status:'verified',issuer:'test-provider',challenge:r.challenge,issuedAt:r.requestedAt,expiresAt:new Date(now+60000).toISOString(),binding,
      evidence:{reference:'test-only',bindingDigest:sessionBindingDigest({...binding,capabilities:[...binding.capabilities]}),identityVerified:true,modelVerified:true,profileVerified:true,capabilitiesVerified:true,availabilityVerified:true}};
  }},{agentId:'Analytics',provider:'codex',modelId:'gpt-6.1-sol',profile:'BALANCED',capability:'analysis'},{now:()=>now});
  assert.equal(attestation.status,'verified');if(attestation.status!=='verified')throw Error('fixture');
  assert.equal(selectOperationalRoute({...input,proof:undefined,attestation}).action,'agent');
  assert.equal(selectOperationalRoute({...input,attestation:structuredClone(attestation)}).action,'blocked');
  assert.equal(selectOperationalRoute({...input,now:now+60000,attestation}).action,'blocked');
});

test('deterministic hint never bypasses critical approval or dispatches a model', () => {
  assert.equal(selectOperationalRoute({...input,request:{...input.request,signals:{deterministic:true,securityCritical:true}}}).action,'blocked');
  assert.equal(selectOperationalRoute({...input,request:{...input.request,signals:{deterministic:true}}}).action,'deterministic');
});

test('planning cannot use declared proof or synthetic ECONOMY signals',()=>{
  const result=selectOperationalRoute({...input,request:{taskType:'planning',capability:'planning',signals:{taskKind:'read',technicalRisk:'low'}}});
  assert.equal(result.action,'blocked');assert.equal(result.profile,'ADVANCED');
});
