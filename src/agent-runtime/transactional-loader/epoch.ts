import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { mkdir, lstat, rm, open, readFile, rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { canonical, digest } from '../contracts.js';
import type { NativeAdmissionFence } from '../native/admission.js';
import type { ActivePointer, TransactionalGenerationLoader } from './loader.js';

export interface RuntimeEpochToken {
  generationId:string;epoch:number;manifestDigest:string;
}
export interface PersistentLockOwner {version:1;pid:number;host:string;ownerId:string;acquiredAt:string;}
export interface OrphanLockAuthorization {version:1;lockName:string;ownerDigest:string;pid:number;host:string;
  ownerId:string;approvedBy:string;expiresAt:string;}
export interface SignedOrphanLockAuthorization {payload:OrphanLockAuthorization;signature:string;}
const lockName=(name:string)=>/^(?:epoch|activation)\.lock$/.test(name);
export async function inspectPersistentLock(root:string,name:string):Promise<PersistentLockOwner|null> {
  if(!lockName(name))throw Error('RUNTIME_LOCK_NAME_INVALID');
  const path=join(root,name),ownerPath=join(path,'owner.json');
  try {
    const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink())throw Error('RUNTIME_LOCK_INVALID');
    const file=await lstat(ownerPath);if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)throw Error('RUNTIME_LOCK_OWNER_INVALID');
    const owner=JSON.parse(await readFile(ownerPath,'utf8')) as PersistentLockOwner;
    if(owner.version!==1||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.host!=='string'||
      !/^[a-f0-9-]{36}$/.test(owner.ownerId)||!Number.isFinite(Date.parse(owner.acquiredAt)))throw Error('RUNTIME_LOCK_OWNER_INVALID');
    return owner;
  }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
async function processIsProvablyDead(pid:number) {
  try{process.kill(pid,0);return false;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return true;throw Error('RUNTIME_LOCK_OWNER_LIVENESS_UNPROVEN');}
}
/** Only an operator-signed authorization plus local ESRCH evidence can quarantine an orphan lock. */
export async function recoverOrphanLock(root:string,authorization:SignedOrphanLockAuthorization,publicKey:string) {
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)!==0)
    throw Error('RUNTIME_EPOCH_ROOT_INVALID');
  const a=authorization?.payload;
  if(!a||!lockName(a.lockName)||createPublicKey(publicKey).asymmetricKeyType!=='ed25519'||
    typeof authorization.signature!=='string'||!verify(null,Buffer.from(canonical(a)),publicKey,Buffer.from(authorization.signature,'base64')))
    throw Error('RUNTIME_LOCK_RECOVERY_AUTHORIZATION_INVALID');
  if(a.version!==1||!a.approvedBy?.trim()||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())
    throw Error('RUNTIME_LOCK_RECOVERY_AUTHORIZATION_INVALID');
  if(a.host!==hostname())throw Error('RUNTIME_LOCK_OWNER_HOST_MISMATCH');
  const owner=await inspectPersistentLock(root,a.lockName);
  if(!owner||owner.pid!==a.pid||owner.host!==a.host||owner.ownerId!==a.ownerId||digest(owner)!==a.ownerDigest)
    throw Error('RUNTIME_LOCK_OWNER_CHANGED');
  if(!await processIsProvablyDead(owner.pid))throw Error('RUNTIME_LOCK_OWNER_STILL_ACTIVE');
  const archive=join(root,'orphan-locks');await mkdir(archive,{recursive:true,mode:0o700});
  const archiveStat=await lstat(archive);
  if(!archiveStat.isDirectory()||archiveStat.isSymbolicLink()||(archiveStat.mode&0o077)!==0)
    throw Error('RUNTIME_LOCK_ARCHIVE_INVALID');
  const target=join(archive,`${a.lockName}.${owner.ownerId}`);
  const latest=await inspectPersistentLock(root,a.lockName);
  if(!latest||digest(latest)!==a.ownerDigest)throw Error('RUNTIME_LOCK_OWNER_CHANGED');
  const authorizationPath=target+'.authorization.json';
  const evidence=await open(authorizationPath,'wx',0o600);
  try{await evidence.writeFile(JSON.stringify(authorization,null,2)+'\n');await evidence.sync();}finally{await evidence.close();}
  const archiveBeforeRename=await open(archive,'r');try{await archiveBeforeRename.sync();}finally{await archiveBeforeRename.close();}
  await rename(join(root,a.lockName),target);
  const handle=await open(root,'r');try{await handle.sync();}finally{await handle.close();}
  const archived=await open(archive,'r');try{await archived.sync();}finally{await archived.close();}
  return {recovered:true,lockName:a.lockName,ownerDigest:a.ownerDigest,evidencePath:target};
}
/** A process lease is bound to one immutable pointer and the same OS lock used by swaps. */
export class RuntimeEpochLease {
  private constructor(private loader:TransactionalGenerationLoader,readonly token:RuntimeEpochToken,
    private fence:NativeAdmissionFence) {}
  static bind(loader:TransactionalGenerationLoader,token:RuntimeEpochToken,fence:NativeAdmissionFence) {
    if(!Number.isSafeInteger(token.epoch)||token.epoch<1||!/^[a-f0-9-]{36}$/.test(token.generationId)||
      !/^[a-f0-9]{64}$/.test(token.manifestDigest))throw Error('RUNTIME_EPOCH_TOKEN_INVALID');
    return new RuntimeEpochLease(loader,Object.freeze({...token}),fence);
  }
  async validateStartup(){
    await this.loader.withEpochLock(async current=>{
      if(!current||current.generationId!==this.token.generationId||current.epoch!==this.token.epoch||
        current.manifestDigest!==this.token.manifestDigest)
        throw Error('RUNTIME_EPOCH_STALE');
      await this.loader.verifyActivePointer(current);
    });
  }
  async run<T>(effect:()=>Promise<T>):Promise<T> {
    return this.loader.withEpochLock(async current=>{
      if(!current||current.generationId!==this.token.generationId||current.epoch!==this.token.epoch||
        current.manifestDigest!==this.token.manifestDigest)throw Error('RUNTIME_EPOCH_STALE');
      await this.loader.verifyActivePointer(current);
      return effect();
    });
  }
  /** Loader holds the cross-process epoch lock while checking quiescence and swapping. */
  async activate<T>(effect:(current:ActivePointer|null)=>Promise<T>):Promise<T> {
    return this.loader.withEpochLock(async current=>{
      const snapshot=await this.fence.snapshot();
      if(snapshot.phase!=='READY_TO_ACTIVATE'||snapshot.recovered||snapshot.poisoned||
        snapshot.inFlight||snapshot.pendingClaims||snapshot.ambiguousDeliveries||snapshot.legacyClaims.length)
        throw Error('RUNTIME_EPOCH_FENCE_NOT_READY');
      if(current)await this.loader.verifyActivePointer(current);
      return effect(current);
    });
  }
}
export async function privateEpochLock(root:string,waitMs=5000) {
  await mkdir(root,{recursive:true,mode:0o700});
  const st=await lstat(root);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw Error('RUNTIME_EPOCH_ROOT_INVALID');
  return privatePersistentLock(root,'epoch.lock',waitMs);
}
export async function privatePersistentLock(root:string,name:'epoch.lock'|'activation.lock',waitMs=0) {
  const path=join(root,name);
  const until=Date.now()+waitMs;
  while(true) {
    try{await mkdir(path,{mode:0o700});break;}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      if(Date.now()>=until)throw Error('RUNTIME_EPOCH_LOCKED_REVIEW_REQUIRED');
      // A bounded wait serializes live processes. An orphaned lock is never
      // removed or interpreted as proof that its owner is dead.
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  const owner:PersistentLockOwner={version:1,pid:process.pid,host:hostname(),ownerId:randomUUID(),acquiredAt:new Date().toISOString()};
  const ownerFile=await open(join(path,'owner.json'),'wx',0o600);
  try{await ownerFile.writeFile(JSON.stringify(owner)+'\n');await ownerFile.sync();}finally{await ownerFile.close();}
  const parent=await open(root,'r');try{await parent.sync();}finally{await parent.close();}
  return async()=>{
    const current=await inspectPersistentLock(root,name);
    if(!current||current.ownerId!==owner.ownerId)throw Error('RUNTIME_LOCK_OWNERSHIP_CHANGED');
    await rm(path,{recursive:true});const h=await open(root,'r');try{await h.sync();}finally{await h.close();}
  };
}
