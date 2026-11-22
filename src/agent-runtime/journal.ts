import { open, readFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './contracts.js';
/** Separate run directory; never opens historical jobs for writing. Claims are immutable. */
export class RuntimeJournal {
  constructor(readonly root:string) {}
  private file(name:string) {if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('RUNTIME_RECORD_PATH_INVALID');return join(this.root,name);}
  async initialize() {await mkdir(this.root,{recursive:true,mode:0o700});if((await lstat(this.root)).isSymbolicLink())throw Error('RUNTIME_JOURNAL_SYMLINK');}
  async read<T>(name:string):Promise<T|undefined> {
    const path=this.file(name);
    try {
      const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>10_000_000)throw Error('RUNTIME_RECORD_INVALID');
      const r=JSON.parse(await readFile(path,'utf8'));
      if(r.digest!==digest(r.payload))throw Error('RUNTIME_RECORD_INTEGRITY_FAILED');return r.payload;
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  }
  async write(name:string,payload:unknown,exclusive=false) {
    const file=this.file(name),temporary=exclusive?file:this.file('.'+randomUUID()+'.tmp');
    const handle=await open(temporary,'wx',0o600);
    try {await handle.writeFile(JSON.stringify({payload,digest:digest(payload)}));await handle.sync();}finally{await handle.close();}
    if(!exclusive)await rename(temporary,file);
    const directory=await open(this.root,'r');try{await directory.sync();}finally{await directory.close();}
  }
  async lock() {
    await this.initialize();
    const path=this.file('run.lock');
    const handle=await open(path,'wx',0o600).catch(()=>{throw Error('RUNTIME_RUN_LOCKED_RECONCILIATION_REQUIRED');});
    return async()=>{await handle.close();await rm(path);};
  }
}
