import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNativeObservation } from '../src/agent-runtime/observe-native.js';
const expected={sessionId:'existing-session',agentId:'Analytics',modelId:'approved-model'};
const observation={...expected,provider:'codex',ownership:'managed',connectionId:'existing-connection',
  available:true,scopeEnforced:false,diagnostics:['SEMANTIC_CAPABILITY_EVIDENCE_REQUIRED']};
test('observation confirms current ownership without claiming qualification or isolation',()=>{
  const result=assessNativeObservation([observation],expected);
  assert.equal(result.confirmed,true);
  assert.equal(result.observation.scopeEnforced,false);
  assert.equal(result.qualification,'not-established-by-observation');
});
test('detached, unavailable and disconnected sessions cannot confirm current availability',()=>{
  for(const patch of [{ownership:'managed-detached'},{available:false},{connectionId:null}])
    assert.equal(assessNativeObservation([{...observation,...patch}],expected).confirmed,false);
});
test('observation rejects missing, duplicate, substituted and malformed identities',()=>{
  for(const values of [[],[observation,observation],[{...observation,modelId:'other'}],
    [{...observation,provider:'claude-code'}],[{...observation,agentId:'Validator'}],
    [{...observation,available:'true'}],{}])
    assert.throws(()=>assessNativeObservation(values,expected));
});
