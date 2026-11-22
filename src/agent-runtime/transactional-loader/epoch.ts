import { mkdir, lstat, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { NativeAdmissionFence } from '../native/admission.js';
import type { ActivePointer, TransactionalGenerationLoader } from './loader.js';

export interface RuntimeEpochToken {
  generationId:string;epoch:number;manifestDigest:string;
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
  const path=join(root,'epoch.lock');
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
  const parent=await open(root,'r');try{await parent.sync();}finally{await parent.close();}
  return async()=>{await rm(path,{recursive:true});const h=await open(root,'r');try{await h.sync();}finally{await h.close();}};
}
