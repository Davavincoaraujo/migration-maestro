import { createServer } from 'node:net';
import { chmod, lstat, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesDigest,digest,canonical } from '../contracts.js';
import { RuntimeJournal } from '../journal.js';
import { CodexAppServerDriver } from './codex.js';
import { ClaudeAgentSdkDriver,loadClaudeSdk } from './claude.js';
import { NativeAgentTransport } from './transport.js';
import { NativeAdmissionFence, untrackedNativeClaims, persistedSessionObservations } from './admission.js';
import { NativeAdmissionDispatcher } from './admission-dispatch.js';
import type { RuntimeEpochLease } from '../transactional-loader/epoch.js';
import type { RuntimeGenerationManager } from '../generations/manager.js';
import type { NativeCapabilityVerifier } from './types.js';

export interface NativeServiceConfig {
  version:1;stateDirectory:string;socketPath:string;workspaceId:string;
  providers:{id:string;provider:'codex'|'claude-code';executable?:string;sdkRoot?:string;
    roles:{agentId:string;modelId:string}[];verifier?:{module:string;sha256:string}}[];
}
/** Hash the shipped adapter implementation, not a user-provided name. */
export async function nativeImplementationDigest() {
  const root=dirname(fileURLToPath(import.meta.url));
  const names=(await readdir(root)).filter(n=>/\.(?:ts|js)$/.test(n)).sort();
  return digest(await Promise.all(names.map(async name=>({name,digest:bytesDigest(await readFile(join(root,name)))}))));
}
export function validateNativeConfig(value:unknown):asserts value is NativeServiceConfig {
  const c=value as NativeServiceConfig;
  if(c?.version!==1||!isAbsolute(c.stateDirectory??'')||!isAbsolute(c.socketPath??'')||dirname(c.socketPath)!==resolve(c.stateDirectory)||
    typeof c.workspaceId!=='string'||!c.workspaceId.trim()||!Array.isArray(c.providers)||c.providers.length>2||new Set(c.providers.map(p=>p.id)).size!==c.providers.length)throw Error('NATIVE_CONFIG_INVALID');
  for(const p of c.providers)if(!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||!['codex','claude-code'].includes(p.provider)||!Array.isArray(p.roles)||!p.roles.length||p.roles.length>7||new Set(p.roles.map(r=>r.agentId)).size!==p.roles.length||
    p.roles.some(r=>!['Migration Orchestrator','Analytics','UE-Pattern','Hermes','Validator'].includes(r.agentId)||typeof r.modelId!=='string'||!r.modelId.trim())||
    p.provider==='codex'&&(!p.executable||!isAbsolute(p.executable)))throw Error('NATIVE_PROVIDER_CONFIG_INVALID');
}
export async function initializeNativeService(config:NativeServiceConfig) {
  validateNativeConfig(config);await mkdir(config.stateDirectory,{recursive:true,mode:0o700});
  const stat=await lstat(config.stateDirectory);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077)!==0)throw Error('NATIVE_PRIVATE_DIRECTORY_REQUIRED');
  const keyPath=join(config.stateDirectory,'signing-key.pem');
  let privateKey;
  try {
    const stat=await lstat(keyPath);
    if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)!==0)throw Error('NATIVE_PRIVATE_KEY_PERMISSIONS');
    privateKey=createPrivateKey(await readFile(keyPath));
  }catch(e){
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    privateKey=generateKeyPairSync('ed25519').privateKey;
    await writeFile(keyPath,privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
  }
  const publicKey=createPublicKey(privateKey);
  const moduleDigest=digest({implementation:await nativeImplementationDigest(),config});
  const adapters=config.providers.map(p=>({kind:'native-service',id:p.id,socketPath:config.socketPath,publicKey:publicKey.export({format:'pem',type:'spki'}).toString(),moduleDigest}));
  const adapterPath=join(config.stateDirectory,'team-adapters.json');
  try {
    const installed=JSON.parse(await readFile(adapterPath,'utf8'));
    if(digest(installed)!==digest({version:1,adapters}))throw Error('NATIVE_INSTALLATION_CHANGED_REVIEW_REQUIRED');
  }catch(e){
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    await writeFile(adapterPath,JSON.stringify({version:1,adapters},null,2)+'\n',{flag:'wx',mode:0o600});
  }
  return {adapterConfig:join(config.stateDirectory,'team-adapters.json'),moduleDigest};
}
async function loadVerifier(spec:NonNullable<NativeServiceConfig['providers'][number]['verifier']>):Promise<NativeCapabilityVerifier> {
  if(!isAbsolute(spec.module)||!/^[a-f0-9]{64}$/.test(spec.sha256))throw Error('NATIVE_VERIFIER_CONFIG_INVALID');
  const bytes=await readFile(spec.module);if(bytesDigest(bytes)!==spec.sha256)throw Error('NATIVE_VERIFIER_DIGEST_MISMATCH');
  const module=await import('data:text/javascript;base64,'+bytes.toString('base64'));
  const verifier=await module.createVerifier();if(typeof verifier?.verify!=='function')throw Error('NATIVE_VERIFIER_INTERFACE_INVALID');return verifier;
}
/** Foreground service keeps official provider streams alive across short-lived Autopilot CLI calls.
 * Preparation is explicit; startup/inspection never create sessions or issue prompts. */
export async function serveNativeRuntimes(config:NativeServiceConfig,options:{generationManager?:RuntimeGenerationManager;epochLease?:RuntimeEpochLease}={}) {
  validateNativeConfig(config);
  if(!config.providers.length)throw Error('NATIVE_CONFIG_INCOMPLETE: configure providers, roles e modelId antes de serve.');
  if(options.generationManager&&!options.epochLease)throw Error('NATIVE_RUNTIME_EPOCH_REQUIRED');
  if(options.epochLease)await options.epochLease.validateStartup();
  const directory=await lstat(config.stateDirectory);if(directory.isSymbolicLink()||!directory.isDirectory()||(directory.mode&0o077)!==0)throw Error('NATIVE_PRIVATE_DIRECTORY_REQUIRED');
  const keyPath=join(config.stateDirectory,'signing-key.pem'),keyStat=await lstat(keyPath);
  if(keyStat.isSymbolicLink()||!keyStat.isFile()||(keyStat.mode&0o077)!==0)throw Error('NATIVE_PRIVATE_KEY_PERMISSIONS');
  const key=createPrivateKey(await readFile(keyPath));
  const installed=JSON.parse(await readFile(join(config.stateDirectory,'team-adapters.json'),'utf8'));
  const codeDigest=digest({implementation:await nativeImplementationDigest(),config}),publicKey=createPublicKey(key).export({format:'pem',type:'spki'}).toString();
  if(installed.adapters.length!==config.providers.length||config.providers.some(p=>!installed.adapters.some((a:any)=>a.id===p.id&&a.publicKey===publicKey&&a.moduleDigest===codeDigest&&a.socketPath===config.socketPath)))throw Error('NATIVE_INSTALLATION_CHANGED_REVIEW_REQUIRED');
  const lockPath=join(config.stateDirectory,'service.lock');
  const lock=await open(lockPath,'wx',0o600).catch(()=>{throw Error('NATIVE_SERVICE_LOCKED');});
  const transports=new Map<string,NativeAgentTransport>();
  const create=async(id:string)=>{
    if(transports.has(id))return transports.get(id)!;
    const p=config.providers.find(p=>p.id===id);if(!p)throw Error('NATIVE_PROVIDER_UNKNOWN');
    const cwd=join(config.stateDirectory,p.id,'workspace'),stateDirectory=join(config.stateDirectory,p.id,'provider');
    await mkdir(cwd,{recursive:true,mode:0o700});
    const verifier=p.verifier?await loadVerifier(p.verifier):undefined;
    const driver=p.provider==='codex'?new CodexAppServerDriver({executable:p.executable!,cwd,stateDirectory}):new ClaudeAgentSdkDriver(await loadClaudeSdk(p.sdkRoot),{cwd,stateDirectory,executable:p.executable});
    const transport=new NativeAgentTransport(p.id,driver,key,config.workspaceId,new RuntimeJournal(join(config.stateDirectory,p.id,'tasks')),verifier);
    transports.set(p.id,transport);return transport;
  };
  let fence:NativeAdmissionFence|undefined;
  try {
    fence=await NativeAdmissionFence.open(config.stateDirectory+'.admission',codeDigest,
      ()=>untrackedNativeClaims(config.stateDirectory,config.providers.map(p=>p.id),fence));
    if(options.generationManager){
      const current=await options.generationManager.assertRuntime(config,publicKey,codeDigest);
      if(current.state!=='ACTIVE'&&current.state!=='UPDATE_PREPARED'){
        // Never reopen a previously requested drain when its process restarts.
        await fence.closeForDrain({generation:current.generation!,manifestDigest:current.manifestDigest!,sequence:current.sequence});
      }
    }
  }catch(e){await lock.close();await rm(lockPath,{force:true});throw e;}
  const admission=fence;
  const dispatcher=new NativeAdmissionDispatcher(admission,config.providers,create,id=>transports.get(id),
    async(id,challenge)=>{
      const p=config.providers.find(p=>p.id===id)!;
      const payload=await persistedSessionObservations(config.stateDirectory,id,p.provider),now=Date.now();
      const body={version:1,issuer:id,kind:'session',challenge,issuedAt:new Date(now).toISOString(),
        expiresAt:new Date(now+60000).toISOString(),payload};
      return {...body,signature:sign(null,Buffer.from(canonical(body)),key).toString('base64')};
    });
  const controlProof=(payload:unknown)=>({payload,signature:sign(null,Buffer.from(canonical(payload)),key).toString('base64')});
  const server=createServer(socket=>{
    let buffer=Buffer.alloc(0),handled=false;socket.setTimeout(25000,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',(chunk:Buffer)=>{
      if(handled)return;buffer=Buffer.concat([buffer,chunk]);if(buffer.length>10_000_000){socket.destroy();return;}
      const newline=buffer.indexOf(10);if(newline<0)return;handled=true;
      const process=async()=>{
        const message=JSON.parse(buffer.subarray(0,newline).toString('utf8'));
        if(message.version!==1||typeof message.transportId!=='string'||
          !['observe','prepare','discover','send','reconcile','collect','admission-status','drain'].includes(message.method))
          throw Error('NATIVE_IPC_METHOD_INVALID');
        if(['admission-status','drain'].includes(message.method)){
          if(message.transportId!=='runtime-control'||typeof message.params?.challenge!=='string'||
            message.params.challenge.length>100)throw Error('NATIVE_CHALLENGE_REQUIRED');
          let generation;
          if(message.method==='drain'){
            if(!options.generationManager)throw Error('GENERATION_MANAGER_NOT_ATTACHED');
            generation=await options.generationManager.requestDrain(message.params.sequence,message.params.approval,admission);
          }
          const snapshot=await admission.snapshot();
          return controlProof({version:1,challenge:message.params.challenge,observedAt:new Date().toISOString(),
            installationDigest:codeDigest,admission:snapshot,...(generation?{generation}:{})});
        }
        return dispatcher.dispatch(message);
      };
      // Hold the cross-process epoch lock from IPC admission through the provider
      // call so activation cannot race a request that may still cause an effect.
      const operation=options.epochLease?options.epochLease.run(process):process();
      void operation.then(result=>socket.end(JSON.stringify({result})+'\n'),e=>socket.end(JSON.stringify({error:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'NATIVE_OPERATION_FAILED'})+'\n'));
    });
  });
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.socketPath,()=>{server.off('error',reject);resolve();});});
    await chmod(config.socketPath,0o600);
  }catch(e){for(const t of transports.values())t.close();await lock.close();await rm(lockPath,{force:true});throw e;}
  return {admission,close:async()=>{await admission.shutdown();for(const t of transports.values())t.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await lock.close();await rm(lockPath,{force:true});await rm(config.socketPath,{force:true});}};
}
