import { lstat, mkdir, open, readFile, readdir, realpath, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytesDigest, digest } from '../contracts.js';

export async function regular(path:string) {
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||await realpath(path)!==resolve(path))throw Error('GENERATION_REGULAR_FILE_REQUIRED');
  return readFile(path);
}
export async function privateDirectory(path:string) {
  // Reject aliased parents BEFORE mkdir can write through a symlink.
  let ancestor=resolve(path);
  for(;;){
    try{
      await lstat(ancestor);
      if(await realpath(ancestor)!==ancestor)throw Error('GENERATION_PRIVATE_DIRECTORY_REQUIRED');
      break;
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      ancestor=dirname(ancestor);
    }
  }
  await mkdir(path,{recursive:true,mode:0o700});
  await requirePrivateDirectory(path);
}
export async function requirePrivateDirectory(path:string) {
  const st=await lstat(path);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    await realpath(path)!==resolve(path))throw Error('GENERATION_PRIVATE_DIRECTORY_REQUIRED');
}
export async function syncDirectory(path:string) {
  const h=await open(path,'r');try{await h.sync();}finally{await h.close();}
}
/** Publish only complete records. Hard link is exclusive: concurrent CAS cannot replace evidence.
 * Orphan .pending files are deliberately retained and ignored on recovery. */
export async function publish(path:string,value:unknown) {
  const temporary=join(dirname(path),'.pending-'+randomUUID());
  const h=await open(temporary,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
  await link(temporary,path);
  await syncDirectory(dirname(path));
  await unlink(temporary);
}
export async function inventory(root:string):Promise<Record<string,string>> {
  const result:Record<string,string>={};
  const walk=async(path:string)=>{
    const st=await lstat(path);
    if(st.isSymbolicLink())throw Error('GENERATION_SYMLINK_REJECTED');
    if(st.isDirectory()){
      for(const name of (await readdir(path)).sort()) {
        if(path===root&&['runtime.sock','service.lock'].includes(name))continue;
        await walk(join(path,name));
      }
    } else if(st.isFile()) result[path]=bytesDigest(await regular(path));
    else throw Error('GENERATION_UNSUPPORTED_STATE_ENTRY');
  };
  await walk(root);return result;
}
export function disjoint(a:string,b:string) {
  a=resolve(a);b=resolve(b);
  if(a===b||a.startsWith(b+sep)||b.startsWith(a+sep))throw Error('GENERATION_STORAGE_MUST_BE_ISOLATED');
}
export async function verifyInventory(expected:Record<string,string>) {
  for(const [path,hash] of Object.entries(expected))
    if(bytesDigest(await regular(path))!==hash)throw Error('GENERATION_PRESERVED_FILE_CHANGED');
}
export async function readEnvelope<T>(path:string):Promise<T> {
  const record=JSON.parse((await regular(path)).toString());
  if(!record||typeof record!=='object'||!Object.hasOwn(record,'payload')||record.digest!==digest(record.payload))throw Error('GENERATION_INTEGRITY_FAILED');
  return record.payload;
}
export async function envelope(path:string,payload:unknown){await publish(path,{payload,digest:digest(payload)});}
