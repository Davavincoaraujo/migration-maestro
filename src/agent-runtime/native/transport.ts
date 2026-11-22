import { sign, type KeyLike } from 'node:crypto';
import { canonical,digest,bytesDigest,type AgentRuntimeTransport,type SignedEvidence,type SessionProof,type RuntimeSession,type RuntimeTask,type Delivery,type CollectedResult } from '../contracts.js';
import { RuntimeJournal } from '../journal.js';
import { validateCollectedResult } from '../collector.js';
import type { NativeCapabilityVerifier,NativeDriver,NativeObservation,NativeQualification } from './types.js';

export class NativeAgentTransport implements AgentRuntimeTransport {
  readonly mode='live' as const;
  readonly support={discovery:true,sessionBoundDispatch:true,reconciliation:true,results:true};
  private sessions=new Map<string,{session:RuntimeSession;expires:number}>();
  private observed:NativeObservation[]=[];
  constructor(readonly id:string,private driver:NativeDriver,private key:KeyLike,private workspaceId:string,private journal:RuntimeJournal,private verifier?:NativeCapabilityVerifier) {}
  sign<T>(kind:SignedEvidence<T>['kind'],payload:T,challenge:string,expiresAt?:number):SignedEvidence<T> {
    const now=Date.now(),body={version:1 as const,issuer:this.id,kind,challenge,issuedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+60000,expiresAt??now+60000)).toISOString(),payload};
    return {...body,signature:sign(null,Buffer.from(canonical(body)),this.key).toString('base64')};
  }
  async observations(signal:AbortSignal){this.observed=await this.driver.inspect(signal);return structuredClone(this.observed);}
  cachedObservations():NativeObservation[] {
    return this.observed.map(o=>({...structuredClone(o),available:false,
      diagnostics:[...o.diagnostics,'DRAINING_CACHED_OBSERVATION_AVAILABILITY_UNVERIFIED']}));
  }
  async prepare(agentId:string,modelId:string,signal:AbortSignal){
    const observation=await this.driver.prepare(agentId,modelId,signal);
    this.observed=this.observed.filter(o=>o.sessionId!==observation.sessionId);
    this.observed.push(structuredClone(observation));
    return observation;
  }
  private qualified(observation:NativeObservation,q:NativeQualification|null):q is NativeQualification {
    return !!q&&observation.ownership==='managed'&&observation.available&&(observation.scopeEnforced||q.scopeEnforced===true)&&q.sessionId===observation.sessionId&&q.connectionId===observation.connectionId&&q.modelId===observation.modelId&&
      ['ECONOMY','BALANCED','ADVANCED'].includes(q.profile)&&Array.isArray(q.capabilities)&&q.capabilities.length>0&&q.capabilities.every(c=>typeof c==='string'&&c.length>0)&&
      q.identityVerified===true&&q.modelVerified===true&&q.capabilitiesVerified===true&&q.profileVerified===true&&/^[a-f0-9]{64}$/.test(q.evidenceDigest)&&Date.parse(q.expiresAt)>Date.now();
  }
  async discover(challenge:string,signal:AbortSignal):Promise<SignedEvidence<SessionProof>[]> {
    this.sessions.clear();await this.observations(signal);const results:SignedEvidence<SessionProof>[]=[];
    for(const observation of this.observed) {
      if(observation.ownership!=='managed'||!observation.agentId||!observation.connectionId||!observation.modelId)continue;
      const qualification=await this.verifier?.verify(Object.freeze(structuredClone(observation)),signal)??null;
      if(!this.qualified(observation,qualification))continue;
      const session:RuntimeSession={version:2,transportId:this.id,agentId:observation.agentId,provider:observation.provider,modelId:observation.modelId,profile:qualification.profile,
        capabilities:qualification.capabilities,available:true,sessionId:observation.sessionId,connectionId:observation.connectionId,workspaceId:this.workspaceId,
        address:{kind:'runtime',protocol:observation.provider==='codex'?'codex-app-server':'claude-agent-sdk'}};
      this.sessions.set(session.sessionId,{session,expires:Math.min(Date.now()+60000,Date.parse(qualification.expiresAt))});
      results.push(this.sign('session',{session,guarantees:{identity:true,model:true,profile:true,capabilities:true,availability:true,scopeEnforced:true}},challenge,Date.parse(qualification.expiresAt)));
    }
    return results;
  }
  private check(task:RuntimeTask) {
    const current=this.sessions.get(task.session.sessionId);
    if(!current||current.expires<=Date.now()||digest(current.session)!==digest(task.session)||task.scope!=='artifact-only-no-external-writes'||task.agentId!==current.session.agentId||
      !/^[a-f0-9-]{36}$/.test(task.taskId)||!/^[a-f0-9]{64}$/.test(task.authorizationDigest)||task.resultContractVersion!==2)throw Error('NATIVE_VERIFIED_OWNED_SESSION_REQUIRED');
  }
  async send(task:RuntimeTask,challenge:string,signal:AbortSignal) {
    this.check(task);await this.journal.initialize();
    await this.journal.write('task-'+task.taskId+'.json',{requestDigest:digest(task),task},true);
    const accepted=await this.driver.execute(task.session.sessionId,task.taskId,JSON.stringify({...task,prompt:task.prompt+' Native provider wire format overrides artifact serialization: return artifacts as {file,content} with exact UTF-8 text, and omit result.artifacts. The adapter computes base64 and SHA-256; do not calculate hashes yourself. Match the provided output schema.'}),signal);
    if(accepted.sessionId!==task.session.sessionId||accepted.requestId!==task.taskId)throw Error('NATIVE_DELIVERY_CORRELATION_FAILED');
    const receipt:Delivery={accepted:true,taskId:task.taskId,requestDigest:digest(task),sessionDigest:digest(task.session),receiptId:accepted.turnId,providerEvidence:{protocol:this.driver.provider,sessionId:accepted.sessionId,requestId:accepted.requestId,acceptanceEventDigest:accepted.eventDigest}};
    return this.sign('delivery',receipt,challenge);
  }
  private async checkSaved(task:RuntimeTask) {
    const saved=await this.journal.read<{requestDigest:string}>('task-'+task.taskId+'.json');
    if(!saved||saved.requestDigest!==digest(task))throw Error('NATIVE_REQUEST_CONFLICT');
  }
  async reconcile(task:RuntimeTask,challenge:string,signal:AbortSignal) {
    await this.checkSaved(task);
    const accepted=await this.driver.reconcile(task.session.sessionId,task.taskId,signal);if(!accepted)return null;
    if(accepted.sessionId!==task.session.sessionId||accepted.requestId!==task.taskId)throw Error('NATIVE_DELIVERY_CORRELATION_FAILED');
    return this.sign<Delivery>('delivery',{accepted:true,taskId:task.taskId,requestDigest:digest(task),sessionDigest:digest(task.session),receiptId:accepted.turnId,providerEvidence:{protocol:this.driver.provider,sessionId:accepted.sessionId,requestId:accepted.requestId,acceptanceEventDigest:accepted.eventDigest}},challenge);
  }
  async collect(task:RuntimeTask,challenge:string,signal:AbortSignal) {
    await this.checkSaved(task);
    const completed=await this.driver.collect(task.session.sessionId,task.taskId,signal);if(!completed)return null;
    const accepted=await this.driver.reconcile(task.session.sessionId,task.taskId,signal);
    if(!accepted||completed.turnId!==accepted.turnId||completed.requestId!==task.taskId||completed.sessionId!==task.session.sessionId||completed.modelId!==task.session.modelId||completed.status!=='completed')throw Error('NATIVE_COMPLETION_CORRELATION_FAILED');
    const output=completed.output as {result:Record<string,unknown>;artifacts:{file:string;content:string}[]};
    if(!output?.result||typeof output.result!=='object'||Array.isArray(output.result)||!Array.isArray(output.artifacts)||output.artifacts.length>20||output.artifacts.some(a=>typeof a.file!=='string'||typeof a.content!=='string'))throw Error('NATIVE_OUTPUT_SCHEMA_INVALID');
    const artifacts=output.artifacts.map(a=>({file:a.file,bytesBase64:Buffer.from(a.content,'utf8').toString('base64')}));
    const result={...output.result,artifacts:output.artifacts.map(a=>({file:a.file,digest:bytesDigest(Buffer.from(a.content,'utf8'))}))};
    const value:CollectedResult={accepted:true,taskId:task.taskId,requestDigest:digest(task),sessionDigest:digest(task.session),receiptId:completed.turnId,providerEvidence:{protocol:this.driver.provider,sessionId:completed.sessionId,requestId:completed.requestId,acceptanceEventDigest:accepted.eventDigest,completionEventDigest:completed.eventDigest},result,artifacts};
    validateCollectedResult(value,task,completed.turnId);
    return this.sign('result',value,challenge);
  }
  close(){this.driver.close();}
}
