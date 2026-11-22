import type { NativeAdmissionFence } from '../native/admission.js';
import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { canonical, digest, bytesDigest } from '../contracts.js';
import { nativeImplementationDigest, type NativeServiceConfig } from '../native/service.js';
import { inspectInstallation, inspectDrivers, validateAddition, type Installation, type DriverPin } from './inspection.js';
import { disjoint, privateDirectory, requirePrivateDirectory, envelope, readEnvelope, regular, verifyInventory, inventory, syncDirectory } from './storage.js';

export type GenerationState='ACTIVE'|'UPDATE_PREPARED'|'DRAINING'|'READY_TO_ACTIVATE'|'ACTIVATED'|'ROLLBACK_REQUIRED';
export const transitions:Record<GenerationState,readonly GenerationState[]>={
  ACTIVE:['UPDATE_PREPARED'],UPDATE_PREPARED:['DRAINING','ROLLBACK_REQUIRED'],
  DRAINING:['READY_TO_ACTIVATE','ROLLBACK_REQUIRED'],
  READY_TO_ACTIVATE:['ACTIVATED','ROLLBACK_REQUIRED'],
  ACTIVATED:['ROLLBACK_REQUIRED'],ROLLBACK_REQUIRED:['ACTIVE']
};
export function assertTransition(from:GenerationState,to:GenerationState) {
  if(!transitions[from]?.includes(to))throw Error('GENERATION_TRANSITION_INVALID');
}
interface Event {
  version:1;sequence:number;previous:string|null;state:GenerationState;
  generation:string|null;manifestDigest:string|null;at:string;reason:string;evidence:unknown;
}
export interface Manifest {
  version:1;id:string;baseDigest:string;config:NativeServiceConfig;
  implementation:string;drivers:DriverPin[];adapters:Installation['adapters'];
  access:'verified'|'unverified';accessEvidenceDigests?:Record<string,string>;createdAt:string;
}
export interface Signed<T> {payload:T;signature:string;}
export interface Approval {
  version:1;action:'DRAIN'|'ROLLBACK';generation:string;manifestDigest:string;
  sequence:number;approvedBy:string;expiresAt:string;
}
export interface DrainReport {
  version:1;generation:string;manifestDigest:string;sequence:number;observedAt:string;expiresAt:string;
  admissionClosed:boolean;runtimeStopped:boolean;inFlight:number;pendingClaims:number;ambiguousDeliveries:number;
  sessions:{sessionId:string;ownership:'managed'|'managed-detached'|'external';available:boolean;safeToClose:boolean}[];
  evidenceDigest:string;
}
function verifySigned<T>(record:Signed<T>,publicKey:string) {
  if(!record?.payload||typeof record.signature!=='string'||
    !verify(null,Buffer.from(canonical(record.payload)),publicKey,Buffer.from(record.signature,'base64')))
    throw Error('GENERATION_SIGNATURE_INVALID');
}
export function assertDrained(report:DrainReport,now=Date.now()) {
  if(report.version!==1||!Number.isFinite(Date.parse(report.observedAt))||
    Date.parse(report.observedAt)>now||Date.parse(report.observedAt)<now-60000||
    !Number.isFinite(Date.parse(report.expiresAt))||Date.parse(report.expiresAt)<=now||
    Date.parse(report.expiresAt)>now+60000||!/^[a-f0-9]{64}$/.test(report.evidenceDigest))
    throw Error('GENERATION_DRAIN_EVIDENCE_INVALID');
  if(report.admissionClosed!==true||report.runtimeStopped!==true||
    report.inFlight!==0||report.pendingClaims!==0||report.ambiguousDeliveries!==0||
    !Array.isArray(report.sessions)||new Set(report.sessions.map(s=>s.sessionId)).size!==report.sessions.length||
    report.sessions.some(s=>typeof s.sessionId!=='string'||!s.sessionId||
      !['managed','managed-detached','external'].includes(s.ownership)||s.available!==false||
      s.safeToClose!==true||s.ownership==='managed'))
    throw Error('GENERATION_DRAIN_BLOCKED');
}
export function detachedSessions(sessions:DrainReport['sessions']) {
  return sessions.filter(s=>s.ownership!=='external').map(s=>({
    sessionId:s.sessionId,ownership:'managed-detached' as const,available:false,
    replacementAuthorizationRequired:true
  }));
}

/** Offline control plane. It never writes installation paths, signs with its private
 * key, stops a process, clears a lock, resumes a session or dispatches a task.
 * ACTIVATED is reserved until a fenced generation-aware loader is integrated. */
export class RuntimeGenerationManager {
  readonly root:string;
  constructor(root:string){this.root=resolve(root);}
  private eventPath(n:number){return join(this.root,'events',String(n).padStart(8,'0')+'.json');}
  private generationPath(id:string) {
    if(!/^[a-f0-9-]{36}$/.test(id))throw Error('GENERATION_ID_INVALID');
    return join(this.root,'candidates',id);
  }
  private async base(){return readEnvelope<{installation:Installation;approvalPublicKey:string}>(join(this.root,'base.json'));}
  async initialize(configPath:string,approvalPublicKey:string) {
    if(createPublicKey(approvalPublicKey).asymmetricKeyType!=='ed25519')throw Error('GENERATION_APPROVER_KEY_INVALID');
    const installation=await inspectInstallation(configPath);
    disjoint(this.root,installation.config.stateDirectory);
    disjoint(this.root,dirname(installation.configPath));
    await privateDirectory(this.root);
    await privateDirectory(join(this.root,'events'));
    await privateDirectory(join(this.root,'candidates'));
    const base={installation,approvalPublicKey};
    try{await envelope(join(this.root,'base.json'),base);}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      if(digest(await this.base())!==digest(base))throw Error('GENERATION_BASE_CONFLICT');}
    const event:Event={version:1,sequence:0,previous:null,state:'ACTIVE',generation:null,
      manifestDigest:null,at:new Date().toISOString(),reason:'Imported read-only installation snapshot',evidence:{baseDigest:digest(base)}};
    try{await envelope(this.eventPath(0),event);}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    return this.status();
  }
  async history():Promise<Event[]> {
    // Recheck private storage on every access; do not follow a replaced directory.
    await requirePrivateDirectory(this.root);
    await requirePrivateDirectory(join(this.root,'events'));
    const names=(await readdir(join(this.root,'events'))).filter(n=>!n.startsWith('.pending-')).sort();
    if(!names.length)throw Error('GENERATION_NOT_INITIALIZED');
    const events:Event[]=[];
    for(let i=0;i<names.length;i++){
      if(names[i]!==String(i).padStart(8,'0')+'.json')throw Error('GENERATION_HISTORY_GAP');
      const event=await readEnvelope<Event>(this.eventPath(i));
      if(event.version!==1||event.sequence!==i||event.previous!==(i?digest(events[i-1]):null))
        throw Error('GENERATION_HISTORY_INVALID');
      if(i)assertTransition(events[i-1].state,event.state);
      else if(event.state!=='ACTIVE'||(event.evidence as {baseDigest?:string})?.baseDigest!==digest(await this.base()))
        throw Error('GENERATION_HISTORY_INVALID');
      events.push(event);
    }
    return events;
  }
  async status(){return (await this.history()).at(-1)!;}
  private async commit(before:Event,to:GenerationState,reason:string,evidence:unknown,
    generation=before.generation,manifestDigest=before.manifestDigest) {
    assertTransition(before.state,to);
    const event:Event={version:1,sequence:before.sequence+1,previous:digest(before),state:to,
      generation,manifestDigest,at:new Date().toISOString(),reason,evidence};
    // Exclusive publication of sequence N+1 is the CAS and linearization point.
    try{await envelope(this.eventPath(event.sequence),event);}
    catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('GENERATION_CONCURRENT_UPDATE');throw e;}
    return event;
  }
  private async expected(sequence:number) {
    const current=await this.status();
    if(current.sequence!==sequence)throw Error('GENERATION_STALE_SEQUENCE');
    return current;
  }
  private async verifyBase() {
    const {installation}=await this.base();
    if(bytesDigest(await regular(installation.configPath))!==installation.configHash||
      await nativeImplementationDigest()!==installation.implementation)
      throw Error('GENERATION_BASE_CHANGED');
    await verifyInventory(installation.files);
    if(digest(await inventory(installation.config.stateDirectory))!==digest(installation.files))
      throw Error('GENERATION_JOURNAL_SET_CHANGED');
    return installation;
  }
  async prepare(config:NativeServiceConfig,sequence:number) {
    config=structuredClone(config);
    const before=await this.expected(sequence);assertTransition(before.state,'UPDATE_PREPARED');
    const installation=await this.verifyBase();validateAddition(installation.config,config);
    const drivers=await inspectDrivers(config);
    await this.verifyBase();
    await requirePrivateDirectory(join(this.root,'candidates'));
    const id=randomUUID(),directory=this.generationPath(id);
    await privateDirectory(directory);
    const moduleDigest=digest({implementation:installation.implementation,config});
    const manifest:Manifest={version:1,id,baseDigest:digest(await this.base()),config:structuredClone(config),
      implementation:installation.implementation,drivers,access:'unverified',createdAt:new Date().toISOString(),
      adapters:{version:1,adapters:config.providers.map(p=>({kind:'native-service',id:p.id,
        socketPath:config.socketPath,publicKey:installation.publicKey,moduleDigest}))}};
    await envelope(join(directory,'manifest.json'),manifest);
    await syncDirectory(join(this.root,'candidates'));
    return this.commit(before,'UPDATE_PREPARED','Candidate only; active installation unchanged',null,id,digest(manifest));
  }
  private async candidate(event:Event) {
    if(!event.generation)throw Error('GENERATION_CANDIDATE_REQUIRED');
    const manifest=await readEnvelope<Manifest>(join(this.generationPath(event.generation),'manifest.json'));
    if(manifest.version!==1||manifest.id!==event.generation||digest(manifest)!==event.manifestDigest||
      manifest.baseDigest!==digest(await this.base()))throw Error('GENERATION_MANIFEST_CHANGED');
    const installation=await this.verifyBase();
    validateAddition(installation.config,manifest.config);
    for(const pin of manifest.drivers){
      await verifyInventory(pin.files);
      if(pin.root&&digest(await inventory(pin.root))!==digest(pin.files))throw Error('GENERATION_DRIVER_CHANGED');
    }
    return manifest;
  }
  private async approval(record:Signed<Approval>,before:Event,action:Approval['action']) {
    verifySigned(record,(await this.base()).approvalPublicKey);
    const a=record.payload;
    if(a.version!==1||a.action!==action||a.generation!==before.generation||
      a.manifestDigest!==before.manifestDigest||a.sequence!==before.sequence||
      typeof a.approvedBy!=='string'||!a.approvedBy.trim()||
      !Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())
      throw Error('GENERATION_APPROVAL_INVALID');
  }
  async runtimeEndpoint() {
    const {installation}=await this.base();
    return {id:'runtime-control',socketPath:installation.config.socketPath,
      publicKey:installation.publicKey,moduleDigest:digest({implementation:installation.implementation,config:installation.config})};
  }
  async assertRuntime(config:NativeServiceConfig,publicKey:string,implementationDigest:string) {
    const {installation}=await this.base();
    if(digest(config)!==digest(installation.config)||publicKey!==installation.publicKey||
      implementationDigest!==digest({implementation:installation.implementation,config:installation.config}))
      throw Error('GENERATION_RUNTIME_BINDING_INVALID');
    return this.status();
  }
  async requestDrain(sequence:number,approval:Signed<Approval>,fence?:NativeAdmissionFence) {
    const before=await this.expected(sequence);assertTransition(before.state,'DRAINING');
    await this.candidate(before);await this.approval(approval,before,'DRAIN');
    if(!fence)throw Error('GENERATION_LIVE_FENCE_REQUIRED');
    const expectedDigest=digest({implementation:(await this.base()).installation.implementation,config:(await this.base()).installation.config});
    if(fence.installationDigest!==expectedDigest)throw Error('GENERATION_RUNTIME_BINDING_INVALID');
    const admission=await fence.closeForDrain({generation:before.generation!,manifestDigest:before.manifestDigest!,sequence:before.sequence+1});
    return this.commit(before,'DRAINING','Admission durably closed; sessions remain alive',{approval,admission});
  }
  async markReady(sequence:number,report:Signed<DrainReport>,fence?:NativeAdmissionFence) {
    const before=await this.expected(sequence);assertTransition(before.state,'READY_TO_ACTIVATE');
    await this.candidate(before);
    verifySigned(report,(await this.base()).installation.publicKey);
    const r=report.payload;
    if(r.generation!==before.generation||r.manifestDigest!==before.manifestDigest||r.sequence!==before.sequence)
      throw Error('GENERATION_DRAIN_BINDING_INVALID');
    assertDrained(r);
    if(!fence)throw Error('GENERATION_LIVE_FENCE_REQUIRED');
    const installed=(await this.base()).installation;
    if(fence.installationDigest!==digest({implementation:installed.implementation,config:installed.config}))
      throw Error('GENERATION_RUNTIME_BINDING_INVALID');
    return fence.confirmReady({generation:before.generation!,manifestDigest:before.manifestDigest!,sequence:before.sequence},
      ()=>this.commit(before,'READY_TO_ACTIVATE','Drain report and live fence verified; loader still required',
        {report,detachedSessions:detachedSessions(r.sessions)}));
  }
  async activate(sequence:number):Promise<never> {
    const before=await this.expected(sequence);assertTransition(before.state,'ACTIVATED');
    await this.candidate(before);
    const evidence=before.evidence as {report:Signed<DrainReport>};
    assertDrained(evidence.report.payload);
    // Admission remains closed, but no transactional loader or safe session
    // handover exists. Never treat a persisted report as authorization to activate.
    throw Error('GENERATION_ACTIVATION_BLOCKED_FENCED_LOADER_NOT_IMPLEMENTED');
  }
  async recover(sequence:number) {
    const before=await this.expected(sequence);
    if(before.state==='ACTIVE'){await this.verifyBase();return before;}
    if(before.state==='ROLLBACK_REQUIRED')return before;
    try{await this.candidate(before);}
    catch(e){return this.commit(before,'ROLLBACK_REQUIRED','Recovery integrity check failed',
      {error:e instanceof Error?e.message:'GENERATION_RECOVERY_FAILED'});}
    if(['DRAINING','READY_TO_ACTIVATE','ACTIVATED'].includes(before.state))
      return this.commit(before,'ROLLBACK_REQUIRED','Interrupted coordination needs fresh review; no automatic resume',null);
    return before; // UPDATE_PREPARED is safe to resume without runtime actions.
  }
  async requestRollback(sequence:number) {
    const before=await this.expected(sequence);
    return this.commit(before,'ROLLBACK_REQUIRED','Rollback requested; installation remains unchanged',null);
  }
  async rollback(sequence:number,approval:Signed<Approval>) {
    const before=await this.expected(sequence);assertTransition(before.state,'ACTIVE');
    await this.approval(approval,before,'ROLLBACK');await this.verifyBase();
    if((await this.history()).some(e=>e.state==='ACTIVATED'))
      throw Error('GENERATION_POST_ACTIVATION_ROLLBACK_REQUIRES_FENCED_LOADER');
    // Cancel only offline preparation. Never rewind journals or delete candidates.
    return this.commit(before,'ACTIVE','Offline candidate cancelled; all evidence retained',approval,null,null);
  }
}
