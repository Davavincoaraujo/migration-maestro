import type { NativeObservation } from './native/types.js';

/** Evaluate verified IPC observations; this does not qualify semantic capabilities. */
export function assessNativeObservation(values:unknown, expected:{sessionId:string;modelId:string;agentId:string}) {
  if(!Array.isArray(values))throw Error('NATIVE_OBSERVATION_INVALID');
  const matches=values.filter(v=>v&&typeof v==='object'&&v.sessionId===expected.sessionId);
  if(matches.length!==1)throw Error('NATIVE_EXPECTED_SESSION_MISSING_OR_DUPLICATED');
  const value=matches[0] as NativeObservation;
  if(value.provider!=='codex'||value.agentId!==expected.agentId||value.modelId!==expected.modelId)
    throw Error('NATIVE_EXPECTED_IDENTITY_OR_MODEL_MISMATCH');
  if(typeof value.available!=='boolean'||typeof value.scopeEnforced!=='boolean'||
    !['managed','managed-detached','external'].includes(value.ownership)||
    !Array.isArray(value.diagnostics)||value.diagnostics.some(d=>typeof d!=='string'))
    throw Error('NATIVE_OBSERVATION_INVALID');
  const confirmed=value.ownership==='managed'&&value.available===true&&
    typeof value.connectionId==='string'&&value.connectionId.length>0;
  return {confirmed,observedAt:new Date().toISOString(),observation:value,
    qualification:'not-established-by-observation' as const};
}
