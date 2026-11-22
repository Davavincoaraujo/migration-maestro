import { createHash, verify } from 'node:crypto';
import type { DispatchRequest } from '../autopilot/dispatch-executor.js';
import type { AdaptiveProfile, Provider } from '../ai/model-router.js';

export const teamStages=['ANALYZE','DISCOVER_COMPONENTS','MAP_COMPONENTS','PLAN','IMPLEMENT','VALIDATE'] as const;
export type TeamStage=typeof teamStages[number];
export const stageDependencies:Record<TeamStage,readonly TeamStage[]>={
  ANALYZE:[],DISCOVER_COMPONENTS:['ANALYZE'],MAP_COMPONENTS:['ANALYZE','DISCOVER_COMPONENTS'],
  PLAN:['MAP_COMPONENTS'],IMPLEMENT:['PLAN'],VALIDATE:['IMPLEMENT'],
};
export const roles:Record<TeamStage,string|undefined>={ANALYZE:'Analytics',DISCOVER_COMPONENTS:'UE-Pattern',MAP_COMPONENTS:'UE-Pattern',PLAN:'Hermes',IMPLEMENT:'Hermes',VALIDATE:undefined};
export const digest=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
export const bytesDigest=(value:Buffer|string):string=>createHash('sha256').update(value).digest('hex');
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object') {
    const result=JSON.stringify(value);if(result===undefined)throw Error('RUNTIME_NON_JSON_VALUE');return result;
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
}
export interface RuntimeSession {
  version:2; transportId:string; agentId:string; provider:Exclude<Provider,'unknown'>; modelId:string;
  profile:AdaptiveProfile; capabilities:string[]; available:boolean;
  /** Runtime session ID and connection generation, never a display name. */
  sessionId:string; connectionId:string; workspaceId:string;
  address:{kind:'runtime';protocol:'codex-app-server'|'claude-agent-sdk'}|{kind:'maestri';terminalId:string};
}
export interface SignedEvidence<T> { version:1; issuer:string; kind:'session'|'delivery'|'result'; challenge:string; issuedAt:string; expiresAt:string; payload:T; signature:string; }
export interface TrustAnchor {
  transportId:string; publicKey:string; mode:'live'|'simulation';
  /** Review pins the adapter implementation and the origin of the verifier key, not just its name. */
  moduleDigest:string;
}
export interface SessionProof { session:RuntimeSession; guarantees:{identity:true;model:true;profile:true;capabilities:true;availability:true;scopeEnforced:true}; }
export interface RuntimeTask extends DispatchRequest {
  resultContractVersion:2; stage:TeamStage; runId:string; session:RuntimeSession;
  source:{url:string;sha256:string;html:string}; inputs:Record<string,string>;
  inputArtifacts:{stage:TeamStage;file:string;bytesBase64:string}[];
  scope:'artifact-only-no-external-writes'; authorizationDigest:string;
}
export interface Delivery { taskId:string;requestDigest:string;sessionDigest:string;receiptId:string;accepted:true; providerEvidence?:{protocol:string;sessionId:string;requestId:string;acceptanceEventDigest:string;completionEventDigest?:string}; }
export interface CollectedResult extends Delivery { result:unknown; artifacts:{file:string;bytesBase64:string}[]; }
/** Trusted adapters verify official channels before signing. A signature proves the configured
 * authority, not upstream model inference. Implementations must enforce artifact-only isolation. */
export interface AgentRuntimeTransport {
  id:string; mode:'live'|'simulation'; support:{discovery:boolean;sessionBoundDispatch:boolean;reconciliation:boolean;results:boolean};
  observations?(signal:AbortSignal):Promise<unknown[]>;
  close?():void;
  discover(challenge:string,signal:AbortSignal):Promise<SignedEvidence<SessionProof>[]>;
  send(task:Readonly<RuntimeTask>,challenge:string,signal:AbortSignal):Promise<SignedEvidence<Delivery>>;
  reconcile(task:Readonly<RuntimeTask>,challenge:string,signal:AbortSignal):Promise<SignedEvidence<Delivery>|null>;
  collect(task:Readonly<RuntimeTask>,challenge:string,signal:AbortSignal):Promise<SignedEvidence<CollectedResult>|null>;
}
export function verifyEvidence<T>(value:SignedEvidence<T>,anchor:TrustAnchor,kind:SignedEvidence<T>['kind'],challenge:string,now=Date.now()):T {
  if(!value||value.version!==1||value.issuer!==anchor.transportId||value.kind!==kind||value.challenge!==challenge||
    !Number.isFinite(Date.parse(value.issuedAt))||!Number.isFinite(Date.parse(value.expiresAt))||
    Date.parse(value.issuedAt)>now||Date.parse(value.issuedAt)<now-60000||Date.parse(value.expiresAt)<=now||
    Date.parse(value.expiresAt)-Date.parse(value.issuedAt)>60000||typeof value.signature!=='string')throw Error('RUNTIME_EVIDENCE_INVALID');
  const {signature,...body}=value;
  if(!verify(null,Buffer.from(canonical(body)),anchor.publicKey,Buffer.from(signature,'base64')))throw Error('RUNTIME_EVIDENCE_SIGNATURE_INVALID');
  return structuredClone(value.payload);
}
export async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,timeoutMs=5000):Promise<T> {
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(()=>work(abort.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('RUNTIME_TIMEOUT'));},timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
