import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { realpath, lstat } from 'node:fs/promises';
import { bytesDigest, digest } from '../contracts.js';
import { nativeImplementationDigest, validateNativeConfig, type NativeServiceConfig } from '../native/service.js';
import { inventory, regular } from './storage.js';

export interface DriverPin { provider:string;version:string;files:Record<string,string>;root?:string; access:'unverified'; }
export interface Installation {
  configPath:string;config:NativeServiceConfig;configHash:string;
  adapters: {version:1;adapters:{kind:string;id:string;socketPath:string;publicKey:string;moduleDigest:string}[]};
  implementation:string;files:Record<string,string>;publicKey:string;
}
export async function inspectInstallation(configPath:string):Promise<Installation> {
  configPath=await realpath(configPath);
  const raw=await regular(configPath),config=JSON.parse(raw.toString());validateNativeConfig(config);
  const adapters=JSON.parse((await regular(join(config.stateDirectory,'team-adapters.json'))).toString());
  const implementation=await nativeImplementationDigest();
  const expected=digest({implementation,config});
  const publicKey=adapters?.adapters?.[0]?.publicKey;
  if(!publicKey||createPublicKey(publicKey).asymmetricKeyType!=='ed25519'||
    adapters.version!==1||adapters.adapters.length!==config.providers.length||
    config.providers.some(p=>adapters.adapters.filter((a:any)=>a.id===p.id&&a.kind==='native-service'&&
      a.socketPath===config.socketPath&&a.moduleDigest===expected&&a.publicKey===publicKey).length!==1))
    throw Error('NATIVE_INSTALLATION_CHANGED_REVIEW_REQUIRED');
  const keyPath=join(config.stateDirectory,'signing-key.pem');
  const keyStat=await lstat(keyPath);
  if((keyStat.mode&0o077)!==0)throw Error('GENERATION_PRIVATE_KEY_PERMISSIONS');
  const key=createPrivateKey(await regular(keyPath));
  if(key.asymmetricKeyType!=='ed25519'||createPublicKey(key).export({format:'pem',type:'spki'}).toString()!==publicKey)
    throw Error('GENERATION_IDENTITY_MISMATCH');
  // Only byte hashes enter snapshots; never export/copy private key material.
  const files=await inventory(config.stateDirectory);
  if(!files[join(config.stateDirectory,'signing-key.pem')])throw Error('GENERATION_IDENTITY_MISSING');
  return {configPath,config,configHash:bytesDigest(raw),adapters,implementation,files,publicKey};
}
export function validateAddition(base:NativeServiceConfig,candidate:NativeServiceConfig) {
  validateNativeConfig(candidate);
  if(digest({...base,providers:[]})!==digest({...candidate,providers:[]})||
    base.providers.some(p=>!candidate.providers.some(q=>digest(p)===digest(q))))
    throw Error('GENERATION_EXISTING_CONFIGURATION_CHANGED');
  const codex=candidate.providers.find(p=>p.id==='codex-local');
  if(codex?.provider!=='codex'||!codex.roles.some(r=>r.agentId==='Analytics'&&r.modelId==='gpt-6-luna'))
    throw Error('GENERATION_ANALYTICS_REQUIRED');
  for(const p of candidate.providers) {
    if(!['codex-local','claude-local'].includes(p.id))throw Error('GENERATION_PROVIDER_UNSUPPORTED');
    if(p.id==='claude-local'&&(p.provider!=='claude-code'||!p.sdkRoot||
      !p.roles.every(r=>r.agentId==='Validator'&&r.modelId==='claude-sonnet-5-5')))
      throw Error('GENERATION_CLAUDE_CANDIDATE_INVALID');
  }
}
export async function inspectDrivers(config:NativeServiceConfig):Promise<DriverPin[]> {
  const result:DriverPin[]=[];
  for(const p of config.providers) {
    if(p.provider==='codex') {
      const executable=await realpath(p.executable!);
      const before=bytesDigest(await regular(executable));
      const {stdout}=await promisify(execFile)(executable,['--version'],{timeout:10000,maxBuffer:4096});
      if(stdout.trim()!=='codex-cli 0.170.0')throw Error('GENERATION_CODEX_VERSION_UNREVIEWED');
      if(bytesDigest(await regular(executable))!==before)throw Error('GENERATION_DRIVER_CHANGED');
      result.push({provider:p.id,version:'0.170.0',files:{[executable]:before},access:'unverified'});
    } else {
      if(!p.sdkRoot||!isAbsolute(p.sdkRoot))throw Error('GENERATION_SDK_ROOT_REQUIRED');
      const require=createRequire(join(resolve(p.sdkRoot),'package.json'));
      const entry=await realpath(require.resolve('@anthropic-ai/claude-agent-sdk'));
      const pkg=JSON.parse((await regular(join(dirname(entry),'package.json'))).toString());
      if(pkg.name!=='@anthropic-ai/claude-agent-sdk'||pkg.version!=='0.3.329'||pkg.claudeCodeVersion!=='2.1.329')
        throw Error('GENERATION_CLAUDE_VERSION_UNREVIEWED');
      result.push({provider:p.id,version:pkg.version,root:dirname(entry),files:await inventory(dirname(entry)),access:'unverified'});
    }
  }
  return result;
}
