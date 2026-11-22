import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../contracts.js';
import { RuntimeJournal } from '../journal.js';

export const admissionPolicy = {
  prepare: { mutable: true, draining: 'deny' },
  send: { mutable: true, draining: 'deny' },
  discover: { mutable: true, draining: 'deny' },
  observe: { mutable: true, draining: 'cached-only' },
  reconcile: { mutable: false, draining: 'existing-transport-only' },
  collect: { mutable: false, draining: 'existing-transport-only' }
} as const;
export type NativeOperation=keyof typeof admissionPolicy;
export interface DrainBinding { generation:string;manifestDigest:string;sequence:number; }
export interface OperationIdentity {
  providerId:string;taskId?:string;taskDigest?:string;sessionId?:string;agentId?:string;
}
interface Tracked {
  id:string;method:NativeOperation;identity:OperationIdentity;
  status:'running'|'accepted'|'ambiguous'|'resolved';evidenceDigest?:string;preparedConnectionId?:string;
}
interface FenceState {
  version:1;revision:number;previous:string|null;installationDigest:string;
  phase:'OPEN'|'DRAINING'|'READY_TO_ACTIVATE';binding:DrainBinding|null;
  recovered:boolean;operations:Tracked[];reason:string;
}
export interface FenceSnapshot {
  phase:FenceState['phase'];revision:number;binding:DrainBinding|null;
  inFlight:number;pendingClaims:number;ambiguousDeliveries:number;
  legacyClaims:string[];recovered:boolean;poisoned:boolean;
}
/** Runtime owner holds service.lock. All state writes are serialized and durable before
 * invoking provider work. The synchronous phase assignment is admission's linearization
 * point. No API reopens this fence or claims a remote cancellation. */
export class NativeAdmissionFence {
  private journal:RuntimeJournal;
  private state!:FenceState;
  private writes:Promise<void>=Promise.resolve();
  private poisoned=false;
  private live=new Set<string>();
  private constructor(readonly root:string,readonly installationDigest:string,
    private readonly legacy:()=>Promise<string[]>) {this.journal=new RuntimeJournal(root);}
  static async open(root:string,installationDigest:string,legacy:()=>Promise<string[]>=async()=>[]) {
    const fence=new NativeAdmissionFence(root,installationDigest,legacy);
    let existed=true;
    try{await lstat(root);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;existed=false;}
    await mkdir(root,{recursive:true,mode:0o700});
    const st=await lstat(root);
    if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('NATIVE_FENCE_PRIVATE_DIRECTORY_REQUIRED');
    const files=(await readdir(root)).sort();
    let previous:FenceState|undefined;
    for(let i=0;i<files.length;i++) {
      if(files[i]!==String(i).padStart(10,'0')+'.json')throw Error('NATIVE_FENCE_HISTORY_INVALID');
      const state=await fence.journal.read<FenceState>(files[i]);
      if(!state||state.version!==1||state.revision!==i||state.previous!==(previous?digest(previous):null)||
        state.installationDigest!==installationDigest||!['OPEN','DRAINING','READY_TO_ACTIVATE'].includes(state.phase)||
        !Array.isArray(state.operations))throw Error('NATIVE_FENCE_HISTORY_INVALID');
      previous=state;
    }
    if(previous) {
      fence.lastPublished=previous;
      fence.state=structuredClone(previous);
      for(const op of fence.state.operations)if(op.status==='running')op.status='ambiguous';
      // Even a formerly OPEN clean process needs explicit recovery after restart.
      fence.state.phase='DRAINING';fence.state.recovered=true;
    } else {
      fence.state={version:1,revision:-1,previous:null,installationDigest,phase:existed?'DRAINING':'OPEN',
        binding:null,recovered:existed,operations:[],reason:''};
    }
    if((await legacy()).length)fence.state.phase='DRAINING';
    await fence.persist(previous?'process-recovery-no-automatic-reopen':'fence-initialized');
    // Ensure a newly created sidecar directory is itself durable.
    const parent=await open(join(root,'..'),'r');try{await parent.sync();}finally{await parent.close();}
    return fence;
  }
  get draining(){return this.state.phase!=='OPEN'||this.poisoned;}
  private persist(reason:string) {
    if(this.poisoned)return Promise.reject(Error('NATIVE_FENCE_PERSISTENCE_FAILED'));
    const previous=this.state.revision<0?null:digest(this.lastPublished);
    this.state.revision++;this.state.previous=previous;this.state.reason=reason;
    const snapshot=structuredClone(this.state);
    this.lastPublished=snapshot;
    const write=this.writes.then(async()=>{
      if(this.poisoned)throw Error('NATIVE_FENCE_PERSISTENCE_FAILED');
      await this.journal.write(String(snapshot.revision).padStart(10,'0')+'.json',snapshot,true);
    });
    this.writes=write.catch(()=>{this.poisoned=true;this.state.phase='DRAINING';});
    return write;
  }
  private lastPublished:FenceState|undefined;
  async execute<T>(method:NativeOperation,identity:OperationIdentity,work:()=>Promise<T>):Promise<T> {
    if(!admissionPolicy[method])throw Error('NATIVE_FENCE_OPERATION_INVALID');
    if(!admissionPolicy[method].mutable)return work();
    // No await between the gate check and the reservation. Queued provider work
    // is already counted, even when draining starts before its callback runs.
    if(this.draining)throw Error('NATIVE_ADMISSION_CLOSED');
    const op:Tracked={id:randomUUID(),method,identity:structuredClone(identity),status:'running'};
    this.state.operations.push(op);this.live.add(op.id);
    await this.persist('operation-admitted');
    try {
      const result=await work();
      op.status=method==='send'?'accepted':'resolved';op.evidenceDigest=digest(result??null);
      if(method==='prepare'&&result&&typeof result==='object'&&'connectionId' in result&&typeof result.connectionId==='string')
        op.preparedConnectionId=result.connectionId;
      this.live.delete(op.id);
      await this.persist('operation-returned');
      return result;
    }catch(e){
      this.live.delete(op.id);
      op.status=['send','prepare'].includes(method)?'ambiguous':'resolved';
      await this.persist('operation-failed-outcome-not-cancellation');
      throw e;
    }
  }
  async shutdown() {
    this.state.phase='DRAINING';
    await this.persist('shutdown-no-remote-cancellation-proof');
  }
  async closeForDrain(binding:DrainBinding) {
    if(this.state.binding&&digest(this.state.binding)!==digest(binding))throw Error('NATIVE_FENCE_BINDING_CONFLICT');
    this.state.phase='DRAINING'; // closes immediately, before durable I/O or manager commit
    this.state.binding=structuredClone(binding);
    await this.persist('drain-admission-closed');
    return this.snapshot();
  }
  /** Only the trusted transport's successful collect path calls this. An ACK,
   * null result, timeout or arbitrary operator assertion never resolves a send. */
  async collected(identity:OperationIdentity,evidence:unknown) {
    const matches=this.state.operations.filter(op=>op.method==='send'&&digest(op.identity)===digest(identity));
    if(!matches.length)throw Error('NATIVE_FENCE_UNKNOWN_CLAIM');
    if(matches.some(op=>this.live.has(op.id)))throw Error('NATIVE_FENCE_OPERATION_STILL_RUNNING');
    for(const op of matches){op.status='resolved';op.evidenceDigest=digest(evidence);}
    await this.persist('correlated-result-collected');
  }
  /** Coverage is only for identifying legacy/untracked claims, never clearing
   * accepted/ambiguous operations (which remain counted independently). */
  covers(providerId:string,record:any,kind:'task'|'request'|'prepare') {
    return this.state.operations.some(op=>{
      const id=op.identity;
      if(id.providerId!==providerId)return false;
      if(kind==='prepare')return op.method==='prepare'&&id.agentId===record.agentId&&op.status==='resolved'&&
        !!op.preparedConnectionId&&op.preparedConnectionId===record.connectionId;
      if(op.method!=='send')return false;
      return kind==='task'?id.taskId===record.task?.taskId&&id.taskDigest===record.requestDigest&&
        digest(record.task)===record.requestDigest:
        id.taskId===record.requestId&&id.sessionId===record.sessionId;
    });
  }
  async snapshot():Promise<FenceSnapshot> {
    await this.writes;
    const legacyClaims=await this.legacy();
    return {phase:this.state.phase,revision:this.state.revision,binding:structuredClone(this.state.binding),
      inFlight:this.live.size,pendingClaims:this.state.operations.filter(o=>o.status!=='resolved').length,
      ambiguousDeliveries:this.state.operations.filter(o=>o.status==='ambiguous').length,
      legacyClaims,recovered:this.state.recovered,poisoned:this.poisoned};
  }
  async confirmReady<T>(binding:DrainBinding,commit:()=>Promise<T>) {
    if(this.state.phase==='OPEN'||!this.state.binding||digest(this.state.binding)!==digest(binding))
      throw Error('NATIVE_FENCE_BINDING_CONFLICT');
    const snapshot=await this.snapshot();
    if(snapshot.poisoned||snapshot.recovered||snapshot.inFlight||snapshot.pendingClaims||
      snapshot.ambiguousDeliveries||snapshot.legacyClaims.length)throw Error('NATIVE_FENCE_NOT_DRAINED');
    this.state.phase='READY_TO_ACTIVATE';
    await this.persist('ready-fence-held-no-activation');
    return commit(); // failure leaves the fence closed, never rolls admission back
  }
}

/** Read legacy journals without initializing them. Existing claims are unresolved
 * unless correlated to this fence's durable operation records. */
export async function untrackedNativeClaims(stateDirectory:string,providerIds:string[],fence?:NativeAdmissionFence) {
  const unknown:string[]=[];
  for(const id of providerIds)for(const kind of ['provider','tasks']){
    const root=join(stateDirectory,id,kind);
    let names:string[];
    try{
      const stat=await lstat(root);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('NATIVE_FENCE_JOURNAL_INVALID');
      names=await readdir(root);
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
    for(const name of names){
      const type=name.startsWith('task-')?'task':name.startsWith('request-')?'request':
        /^prepare-.*\.claim\.json$/.test(name)?'prepare':null;
      if(!type)continue;
      let record:any;
      try{record=await new RuntimeJournal(root).read<any>(name);}
      catch{throw Error('NATIVE_FENCE_JOURNAL_INVALID');}
      if(!record||!fence?.covers(id,record,type))unknown.push(id+'/'+kind+'/'+name);
    }
  }
  return unknown.sort();
}

/** Recovery visibility only: journals cannot prove a live provider connection. */
export async function persistedSessionObservations(stateDirectory:string,id:string,provider:'codex'|'claude-code') {
  const root=join(stateDirectory,id,'provider');
  let names:string[];
  try{
    const stat=await lstat(root);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('NATIVE_FENCE_JOURNAL_INVALID');
    names=await readdir(root);
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  const observations=[];
  for(const name of names.filter(n=>/^session-[a-f0-9]{64}\.json$/.test(n))){
    const value=await new RuntimeJournal(root).read<any>(name);
    if(!value||typeof value.sessionId!=='string'||typeof value.agentId!=='string'||typeof value.modelId!=='string')
      throw Error('NATIVE_FENCE_SESSION_INVALID');
    observations.push({provider,sessionId:value.sessionId,agentId:value.agentId,modelId:value.modelId,
      connectionId:null,ownership:'managed-detached' as const,available:false,scopeEnforced:false,protocolCapabilities:[],
      diagnostics:['DRAINING_PERSISTED_SESSION_NOT_CONNECTED','REPLACEMENT_SESSION_REQUIRES_NEW_AUTHORIZATION']});
  }
  return observations;
}
