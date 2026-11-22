import { createHash, randomUUID } from 'node:crypto';

/** Independent of routing and policy. Only trusted application adapters implement this interface.
 * They must verify the official source, including capability evidence, before returning verified.
 * Neither an issuer string nor a matching digest authenticates an external source by itself. */
export interface SessionAttestationProvider {
  readonly id: string;
  attest(request: Readonly<SessionAttestationRequest>, signal: AbortSignal): Promise<unknown>;
}
export interface SessionExpectation {
  agentId: string; provider: 'codex' | 'claude-code'; modelId: string;
  profile: 'ECONOMY' | 'BALANCED' | 'ADVANCED'; capability: string;
}
export interface SessionAttestationRequest {
  version: 1; challenge: string; requestedAt: string; expected: Readonly<SessionExpectation>;
}
export interface SessionBinding {
  agentId: string; workspaceId: string; terminalId: string; sessionId: string;
  provider: 'codex' | 'claude-code'; modelId: string; profile: 'ECONOMY' | 'BALANCED' | 'ADVANCED';
  capabilities: string[]; available: true;
}
export interface SessionAttestation {
  version: 1; status: 'verified'; issuer: string; challenge: string;
  issuedAt: string; expiresAt: string; binding: SessionBinding;
  evidence: { reference: string; bindingDigest: string; identityVerified: true; modelVerified: true;
    profileVerified: true; capabilitiesVerified: true; availabilityVerified: true };
}
export type SessionAttestationResult = SessionAttestation | {status:'unverified';reason:string};
export const SESSION_ATTESTATION_TTL_MS = 60_000;
const accepted = new WeakSet<object>();
const token = (v:unknown):v is string => typeof v==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:@ /()-]{0,199}$/.test(v);
export function sessionBindingDigest(binding: SessionBinding) {
  return createHash('sha256').update(JSON.stringify({agentId:binding.agentId,workspaceId:binding.workspaceId,
    terminalId:binding.terminalId,sessionId:binding.sessionId,provider:binding.provider,modelId:binding.modelId,
    profile:binding.profile,capabilities:binding.capabilities,available:binding.available})).digest('hex');
}
export function sessionIdentity(binding: SessionBinding) {
  return JSON.stringify([binding.agentId,binding.workspaceId,binding.terminalId,binding.sessionId,binding.provider,binding.modelId]);
}
const unverified = (reason:string):SessionAttestationResult => ({status:'unverified',reason});
export function isCurrentSessionAttestation(value: unknown, now=Date.now()): value is SessionAttestation {
  if(!value || typeof value!=='object' || !accepted.has(value)) return false;
  const a=value as SessionAttestation;
  return Date.parse(a.issuedAt)<=now && now<Date.parse(a.expiresAt) && now-Date.parse(a.issuedAt)<=SESSION_ATTESTATION_TTL_MS;
}
/** No file/snapshot/config import path. Every invocation challenges the trusted provider anew. */
export async function requestSessionAttestation(provider:SessionAttestationProvider,expected:SessionExpectation,
  options:{now?:()=>number;timeoutMs?:number}={}):Promise<SessionAttestationResult> {
  const now=options.now ?? Date.now,started=now(),timeout=options.timeoutMs ?? 3000;
  if(!Number.isFinite(started) || !Number.isInteger(timeout) || timeout<1 || timeout>10000 ||
      !token(provider?.id) || !token(expected.agentId) || !token(expected.modelId) ||
      !['codex','claude-code'].includes(expected.provider) || !['ECONOMY','BALANCED','ADVANCED'].includes(expected.profile) || !token(expected.capability)) return unverified('SESSION_ATTESTATION_REQUEST_INVALID');
  const request:SessionAttestationRequest=Object.freeze({version:1,challenge:randomUUID(),requestedAt:new Date(started).toISOString(),expected:Object.freeze({...expected})});
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let value:any;
  try {
    value=await Promise.race([Promise.resolve().then(()=>provider.attest(request,controller.signal)),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},timeout);})]);
  }catch{return unverified('SESSION_ATTESTATION_PROVIDER_UNAVAILABLE');}
  finally{if(timer)clearTimeout(timer);}
  if(value?.status==='unverified') return unverified(typeof value.reason==='string' && /^[A-Z_]{1,100}$/.test(value.reason)?value.reason:'SESSION_ATTESTATION_UNVERIFIED');
  const b=value?.binding,e=value?.evidence,at=now(),issued=Date.parse(value?.issuedAt),expires=Date.parse(value?.expiresAt);
  if(value?.version!==1 || value.status!=='verified' || value.issuer!==provider.id || value.challenge!==request.challenge ||
      !b || !e || !token(b.agentId) || !token(b.workspaceId) || !token(b.terminalId) || !token(b.sessionId) ||
      b.agentId!==expected.agentId || b.provider!==expected.provider || b.modelId!==expected.modelId || b.profile!==expected.profile || b.available!==true ||
      !Array.isArray(b.capabilities) || !b.capabilities.length || b.capabilities.length>20 || b.capabilities.some((c:unknown)=>!token(c)) ||
      new Set(b.capabilities).size!==b.capabilities.length || !b.capabilities.includes(expected.capability) ||
      typeof value.issuedAt!=='string' || typeof value.expiresAt!=='string' || !Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(at) || issued<started || issued>at || expires<=at || expires<=issued || expires-issued>SESSION_ATTESTATION_TTL_MS ||
      !token(e.reference) || e.identityVerified!==true || e.modelVerified!==true || e.profileVerified!==true ||
      e.capabilitiesVerified!==true || e.availabilityVerified!==true || e.bindingDigest!==sessionBindingDigest(b)) return unverified('SESSION_ATTESTATION_INVALID');
  // Project and freeze; no provider-controlled extras or mutable references reach the router.
  const binding:SessionBinding=Object.freeze({agentId:b.agentId,workspaceId:b.workspaceId,terminalId:b.terminalId,sessionId:b.sessionId,
    provider:b.provider,modelId:b.modelId,profile:b.profile,capabilities:Object.freeze([...b.capabilities]) as unknown as string[],available:true});
  const result:SessionAttestation=Object.freeze({version:1,status:'verified',issuer:value.issuer,challenge:request.challenge,
    issuedAt:value.issuedAt,expiresAt:value.expiresAt,binding,evidence:Object.freeze({reference:e.reference,bindingDigest:e.bindingDigest,
      identityVerified:true,modelVerified:true,profileVerified:true,capabilitiesVerified:true,availabilityVerified:true})});
  accepted.add(result);return result;
}
