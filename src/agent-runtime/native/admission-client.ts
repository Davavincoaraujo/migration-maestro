import { randomUUID, verify } from 'node:crypto';
import { canonical } from '../contracts.js';
import { nativeRequest, type NativeEndpoint } from './client.js';
import type { Signed, Approval } from '../generations/manager.js';

/** Administrative proof is separate from adapter session/task evidence. */
export async function admissionRequest(endpoint:NativeEndpoint,method:'admission-status'|'drain',
  params:{sequence?:number;approval?:Signed<Approval>},signal:AbortSignal) {
  const challenge=randomUUID();
  const response=await nativeRequest({...endpoint,id:'runtime-control'},method,{...params,challenge},signal);
  const payload=response?.payload,now=Date.now();
  if(!payload||payload.version!==1||payload.challenge!==challenge||payload.installationDigest!==endpoint.moduleDigest||
    !Number.isFinite(Date.parse(payload.observedAt))||Date.parse(payload.observedAt)>now||
    Date.parse(payload.observedAt)<now-60000||typeof response.signature!=='string'||
    !verify(null,Buffer.from(canonical(payload)),endpoint.publicKey,Buffer.from(response.signature,'base64')))
    throw Error('NATIVE_ADMISSION_PROOF_INVALID');
  return payload;
}
