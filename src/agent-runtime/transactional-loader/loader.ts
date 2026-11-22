import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonical, digest, bytesDigest } from '../contracts.js';
import { validateNativeConfig } from '../native/service.js';
import { type Manifest } from '../generations/manager.js';
import { privateDirectory, regular, syncDirectory } from '../generations/storage.js';
import { privateEpochLock, RuntimeEpochLease } from './epoch.js';

export interface ApprovedGeneration {
  version:1;generationId:string;manifestPath:string;manifestDigest:string;
  sequence:number;action:'ACTIVATE';expectedPointerDigest:string|null;approvedBy:string;expiresAt:string;
}
export interface ActivationApproval {payload:ApprovedGeneration;signature:string;}
export interface ActivePointer {
  version:1;epoch:number;generationId:string;manifestPath:string;manifestDigest:string;
  previousDigest:string|null;committedAt:string;
}
interface Tx {
  version:1;id:string;expectedPointerDigest:string|null;candidate:ActivePointer;
  phase:'PREPARED'|'COMMITTED'|'ABORTED';at:string;
}
export class TransactionalGenerationLoader {
  readonly root:string;
  constructor(root:string,private readonly failpoint?:(point:'after-pointer-swap')=>void){this.root=resolve(root);}
  private pointerPath(){return join(this.root,'active.json');}
  private transactionPath(){return join(this.root,'transactions');}
  async withEpochLock<T>(work:(current:ActivePointer|null)=>Promise<T>) {
    await privateDirectory(this.root);
    const unlock=await privateEpochLock(this.root);
    try{return await work(await this.current());}finally{await unlock();}
  }
  /** Revalidate the selected generation contents, not just the active pointer. */
  async verifyActivePointer(pointer:ActivePointer) {
    const manifest=await this.readManifest(pointer.manifestPath,pointer.manifestDigest);
    const body=manifest.payload;
    if(body.id!==pointer.generationId||body.version!==1||body.access!=='verified'||!body.accessEvidenceDigests)
      throw Error('LOADER_ACTIVE_GENERATION_INVALID');
    validateNativeConfig(body.config);
    if(body.config.providers.some(p=>!/^[a-f0-9]{64}$/.test(body.accessEvidenceDigests?.[p.id]??'')))
      throw Error('LOADER_PROVIDER_ACCESS_UNVERIFIED');
    const moduleDigest=digest({implementation:body.implementation,config:body.config});
    if(!body.adapters||body.adapters.version!==1||body.adapters.adapters.length!==body.config.providers.length||
      body.config.providers.some(provider=>body.adapters.adapters.filter(a=>a.kind==='native-service'&&a.id===provider.id&&
        a.socketPath===body.config.socketPath&&a.moduleDigest===moduleDigest&&
        a.publicKey===body.adapters.adapters[0]?.publicKey).length!==1))
      throw Error('LOADER_ADAPTER_MANIFEST_INVALID');
    await this.verifyDriverFiles(body);
    return body;
  }
  private async lock() {
    const path=join(this.root,'activation.lock');
    try{await mkdir(path,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('LOADER_ACTIVATION_LOCKED_REVIEW_REQUIRED');throw e;}
    return async()=>{await rm(path,{recursive:true});await syncDirectory(this.root);};
  }
  async current():Promise<ActivePointer|null> {
    try{
      const value=JSON.parse((await regular(this.pointerPath())).toString()) as ActivePointer;
      if(value.version!==1||!Number.isSafeInteger(value.epoch)||value.epoch<1||
        !/^[a-f0-9-]{36}$/.test(value.generationId)||!/^[a-f0-9]{64}$/.test(value.manifestDigest))
        throw Error('LOADER_POINTER_INVALID');
      return value;
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  }
  async verifyCandidate(approval:ActivationApproval,approverPublicKey:string) {
    if(createPublicKey(approverPublicKey).asymmetricKeyType!=='ed25519'||
      !approval?.payload||typeof approval.signature!=='string'||
      !verify(null,Buffer.from(canonical(approval.payload)),approverPublicKey,Buffer.from(approval.signature,'base64')))
      throw Error('LOADER_APPROVAL_INVALID');
    const a=approval.payload;
    if(a.version!==1||a.action!=='ACTIVATE'||!Number.isSafeInteger(a.sequence)||a.sequence<0||typeof a.approvedBy!=='string'||!a.approvedBy.trim()||
      !Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())
      throw Error('LOADER_APPROVAL_EXPIRED_OR_INVALID');
    const path=await realpath(a.manifestPath);
    const validated=await this.readManifest(path,a.manifestDigest);
    const manifest=validated;
    if(!manifest?.payload||typeof manifest.digest!=='string'||manifest.digest!==digest(manifest.payload)||manifest.digest!==a.manifestDigest||
      manifest.payload.id!==a.generationId)
      throw Error('LOADER_MANIFEST_DIGEST_INVALID');
    const body=manifest.payload;
    validateNativeConfig(body.config);
    if(body.access!=='verified'||!body.accessEvidenceDigests||
      body.config.providers.some(p=>!/^[a-f0-9]{64}$/.test(body.accessEvidenceDigests?.[p.id]??'')))
      throw Error('LOADER_PROVIDER_ACCESS_UNVERIFIED');
    const moduleDigest=digest({implementation:body.implementation,config:body.config});
    if(body.adapters.adapters.length!==body.config.providers.length||body.config.providers.some(provider=>
      body.adapters.adapters.filter(a=>a.kind==='native-service'&&a.id===provider.id&&
        a.socketPath===body.config.socketPath&&a.moduleDigest===moduleDigest&&
        a.publicKey===body.adapters.adapters[0]?.publicKey).length!==1))
      throw Error('LOADER_ADAPTER_MANIFEST_INVALID');
    if(body.version!==1||!Array.isArray(body.config.providers)||!Array.isArray(body.drivers)||
      !body.implementation||!body.adapters||body.adapters.version!==1||
      body.adapters.adapters.length!==body.config.providers.length)
      throw Error('LOADER_GENERATION_SCHEMA_INVALID');
    await this.verifyDriverFiles(body);
    const current=await this.current();
    const currentDigest=current?digest(current):null;
    if(a.expectedPointerDigest!==currentDigest)throw Error('LOADER_STALE_POINTER_APPROVAL');
    return {approval:a,manifest:body,manifestDigest:manifest.digest,manifestPath:path};
  }
  private async readManifest(path:string,expectedDigest:string) {
    let manifest:{payload:Manifest;digest:string};
    try{manifest=JSON.parse((await regular(path)).toString());}
    catch{throw Error('LOADER_MANIFEST_DIGEST_INVALID');}
    if(!manifest?.payload||typeof manifest.digest!=='string'||
      manifest.digest!==digest(manifest.payload)||manifest.digest!==expectedDigest)
      throw Error('LOADER_MANIFEST_DIGEST_INVALID');
    return manifest;
  }
  private async verifyDriverFiles(body:Manifest) {
    for(const driver of body.drivers)for(const [file,hash] of Object.entries(driver.files))
      if(bytesDigest(await regular(file))!==hash)throw Error('LOADER_DRIVER_DIGEST_INVALID');
  }
  /** A live runtime must provide a fresh callback that proves admission is closed,
   * this process owns the runtime lock, and all mutable operations are quiescent.
   * Current Native Runtime cannot provide this proof, so activation is unavailable. */
  async activate(approval:ActivationApproval,approverPublicKey:string,sequence:number,
    liveFence?:RuntimeEpochLease,
    authorizePointer?: (pointer:ActivePointer,transactionId:string)=>Promise<void>):Promise<ActivePointer> {
    const verified=await this.verifyCandidate(approval,approverPublicKey);
    if(verified.approval.sequence!==sequence)throw Error('LOADER_APPROVAL_SEQUENCE_INVALID');
    if(!liveFence||!authorizePointer)throw Error('LOADER_LIVE_FENCED_CONSUMER_REQUIRED');
    if(!(liveFence instanceof RuntimeEpochLease))throw Error('LOADER_LIVE_EPOCH_LEASE_REQUIRED');
    return liveFence.activate(async current=>{
      return this.commit(verified.manifestPath,verified.manifestDigest,verified.approval.generationId,verified.approval.expectedPointerDigest,
        async(pointer,txId)=>{
          await authorizePointer!(pointer,txId);
        },true);
    });
  }
  private async commit(path:string,manifestDigest:string,generationId:string,expectedApproval:string|null,beforeSwap:(pointer:ActivePointer,txId:string)=>Promise<void>,epochLockHeld=false) {
    await privateDirectory(this.root);
    const dir=await lstat(this.root);
    if(dir.isSymbolicLink()||!dir.isDirectory()||(dir.mode&0o077)!==0)
      throw Error('LOADER_PRIVATE_ROOT_REQUIRED');
    // Always acquire epoch before activation. This is the same order used by
    // RuntimeEpochLease.activate and recover, avoiding cross-process deadlocks.
    const unlockEpoch=epochLockHeld?async()=>{}:await privateEpochLock(this.root);
    let unlock:()=>Promise<void>;
    try{unlock=await this.lock();}catch(e){await unlockEpoch();throw e;}
    try {
      const old=await this.current(),expected=old?digest(old):null;
      if(expected!==expectedApproval)throw Error('LOADER_STALE_POINTER_APPROVAL');
      const candidate=await this.readManifest(path,manifestDigest);
      const serviceLock=join(candidate.payload.config.stateDirectory,'service.lock');
      try{await lstat(serviceLock);throw Error('LOADER_NATIVE_RUNTIME_STILL_OWNS_SERVICE_LOCK');}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      await this.verifyDriverFiles(candidate.payload);
      const pointer:ActivePointer={version:1,epoch:(old?.epoch??0)+1,generationId,
        manifestPath:path,manifestDigest,previousDigest:expected,committedAt:new Date().toISOString()};
      await mkdir(this.transactionPath(),{recursive:true,mode:0o700});
      const tx:Tx={version:1,id:randomUUID(),expectedPointerDigest:expected,candidate:pointer,phase:'PREPARED',at:new Date().toISOString()};
      const txPath=join(this.transactionPath(),tx.id+'.json');
      await this.durableExclusive(txPath,tx);
      // Single rename is the durable linearization point. Readers see old or new pointer.
      const staging=join(this.root,'.active-'+tx.id+'.tmp');
      await this.durableExclusive(staging,pointer);
      const observed=await this.current();
      if((observed?digest(observed):null)!==expected)throw Error('LOADER_POINTER_COMPARE_FAILED');
      await beforeSwap(pointer,tx.id);
      await this.readManifest(path,manifestDigest);
      await this.verifyDriverFiles(candidate.payload);
      await rename(staging,this.pointerPath());await syncDirectory(this.root);
      this.failpoint?.('after-pointer-swap');
      tx.phase='COMMITTED';
      try{await this.durableExclusive(join(this.transactionPath(),tx.id+'.commit.json'),tx);}
      catch{throw Error('LOADER_POINTER_COMMITTED_AUDIT_PENDING_REVIEW_REQUIRED');}
      return pointer;
    }finally{await unlockEpoch();await unlock();}
  }
  private async durableExclusive(path:string,value:unknown) {
    const handle=await open(path,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
    await syncDirectory(dirname(path));
  }
  /** Called by every IPC request. A process with an old token fails after pointer swap. */
  async assertCurrent(token:{generationId:string;epoch:number;manifestDigest:string}) {
    const current=await this.current();
    if(!current||current.generationId!==token.generationId||current.epoch!==token.epoch||
      current.manifestDigest!==token.manifestDigest)throw Error('LOADER_STALE_PROCESS_FENCED');
  }
  /** Read-only crash classifier. It never steals a stale OS lock or deletes evidence. */
  async inspectRecovery() {
    const current=await this.current(),pointerDigest=current?digest(current):null;
    const lockPath=join(this.root,'activation.lock');
    let lockPresent=false;try{await lstat(lockPath);lockPresent=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let epochLockPresent=false;try{await lstat(join(this.root,'epoch.lock'));epochLockPresent=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let names:string[]=[];
    try{names=(await readdir(this.transactionPath())).filter(n=>n.endsWith('.json')).sort();}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const transactions: {id:string;phase:string;classification:string}[]=[];
    for(const name of names.filter(n=>!n.endsWith('.commit.json'))){
      const tx=JSON.parse((await regular(join(this.transactionPath(),name))).toString()) as Tx;
      if(tx.version!==1||!/^[a-f0-9-]{36}$/.test(tx.id)||name!==tx.id+'.json'||
        !['PREPARED','COMMITTED','ABORTED'].includes(tx.phase))throw Error('LOADER_TRANSACTION_INVALID');
      let commitExists=true;
      try{await regular(join(this.transactionPath(),tx.id+'.commit.json'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')commitExists=false;else throw e;}
      let classification=commitExists?'COMMITTED':
        pointerDigest===digest(tx.candidate)?'POINTER_SWAPPED_AUDIT_INCOMPLETE':
        pointerDigest===tx.expectedPointerDigest?'PREPARED_POINTER_UNCHANGED':'CONFLICT_REQUIRES_REVIEW';
      transactions.push({id:tx.id,phase:tx.phase,classification});
    }
    return {current,pointerDigest,lockPresent,epochLockPresent,transactions,
      recoveryRequired:lockPresent||epochLockPresent||transactions.some(t=>!['COMMITTED'].includes(t.classification)),
      action:lockPresent||epochLockPresent?'verify-owning-process-is-dead; preserve lock and all evidence':
        'review-classification-and-authorize-recovery-explicitly'};
  }
  async recover() {
    // Lock ordering matches activation and request admission.
    const unlockEpoch=await privateEpochLock(this.root);
    let unlock:()=>Promise<void>;
    try{unlock=await this.lock();}catch(e){await unlockEpoch();throw e;}
    try{return await this.inspectRecovery();}
    finally{await unlockEpoch();await unlock();}
  }
}
