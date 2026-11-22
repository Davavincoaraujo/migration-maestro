import type { AdaptiveProfile } from '../../ai/model-router.js';
export interface NativeObservation {
  provider:'codex'|'claude-code';agentId:string|null;sessionId:string;connectionId:string|null;
  ownership:'managed'|'managed-detached'|'external';modelId:string|null;available:boolean;protocolCapabilities:string[];
  /** Only effective runtime restrictions, never a requested flag alone. */
  scopeEnforced:boolean;diagnostics:string[];
}
export interface NativeAcceptance {sessionId:string;requestId:string;turnId:string;eventDigest:string;}
export interface NativeCompletion extends NativeAcceptance {status:'completed';output:unknown;modelId:string;eventDigest:string;}
export interface NativeDriver {
  readonly provider:'codex'|'claude-code';
  inspect(signal:AbortSignal):Promise<NativeObservation[]>;
  prepare(agentId:string,modelId:string,signal:AbortSignal):Promise<NativeObservation>;
  execute(sessionId:string,requestId:string,prompt:string,signal:AbortSignal):Promise<NativeAcceptance>;
  reconcile(sessionId:string,requestId:string,signal:AbortSignal):Promise<NativeAcceptance|null>;
  collect(sessionId:string,requestId:string,signal:AbortSignal):Promise<NativeCompletion|null>;
  close():void;
}
/** Optional trusted verifier composition point. It must validate actual capability evidence,
 * not translate a configured role or protocol feature into a semantic capability. */
export interface NativeQualification {
  sessionId:string;connectionId:string;modelId:string;capabilities:string[];profile:AdaptiveProfile;
  evidenceDigest:string;expiresAt:string;scopeEnforced?:true;identityVerified:true;modelVerified:true;capabilitiesVerified:true;profileVerified:true;
}
export interface NativeCapabilityVerifier {
  verify(observation:Readonly<NativeObservation>,signal:AbortSignal):Promise<NativeQualification|null>;
}
/** Provider wire format: models return UTF-8 content. The trusted adapter computes hashes
 * and base64 from the exact returned bytes, then validates the common StageResultV2. */
export const nativeOutputSchema={type:'object',required:['result','artifacts'],additionalProperties:false,properties:{
  result:{type:'object',required:['version','jobId','taskId','stage','status','summary','evidence'],additionalProperties:false,properties:{
    version:{type:'integer',enum:[2]},jobId:{type:'string'},taskId:{type:'string'},stage:{type:'string'},status:{type:'string',enum:['completed']},summary:{type:'string'},evidence:{type:'array',items:{type:'string'}},
  }},
  artifacts:{type:'array',items:{type:'object',required:['file','content'],additionalProperties:false,properties:{file:{type:'string'},content:{type:'string'}}}},
}};
