import { nativeTransportClient } from './native/client.js';
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { bytesDigest, type AgentRuntimeTransport, type TrustAnchor } from './contracts.js';
import { AgentRuntimeRegistry } from './registry.js';
import { maestriTransport, type MaestriTransport } from '../integrations/maestri-central-cli.js';
import { parseConnectedAgentNames } from '../integrations/maestri-model-router.js';

/** These are capability reports, never pretend implementations of authenticated delivery. */
export const builtInRuntimeSupport=[
  {id:'maestri',provider:null,reason:'MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED',officialInterface:'https://www.themaestri.app/en/docs/wire'},
  {id:'codex-app-server',provider:'codex',reason:'CODEX_NATIVE_SERVICE_CONNECTION_REQUIRED',officialInterface:'https://learn.chatgpt.com/docs/app-server'},
  {id:'claude-agent-sdk',provider:'claude-code',reason:'CLAUDE_NATIVE_SERVICE_CONNECTION_REQUIRED',officialInterface:'https://code.claude.com/docs/en/agent-sdk/overview'},
];
/** Maestri coordinates visibility only. Names cannot enter the verified registry. */
export async function inspectTeamCoordination(transport:MaestriTransport=maestriTransport(undefined,3000)) {
  try {return {connectedNames:parseConnectedAgentNames(await transport('list',[])),sessionVerified:false,deliverySupported:false,reason:'MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED'};}
  catch{return {connectedNames:[],sessionVerified:false,deliverySupported:false,reason:'MAESTRI_COORDINATION_UNAVAILABLE'};}
}
/** Explicit application-code installation boundary. Config is operator controlled, not agent output.
 * Only a reviewed standalone JS bundle with a pinned SHA-256 can be loaded. No transport fixtures
 * are loaded here. The adapter's verifier key must be independently pinned by the operator. */
export async function loadTeamRegistry(configFile?:string):Promise<AgentRuntimeRegistry> {
  if(!configFile)return new AgentRuntimeRegistry([],[]);
  const stat=await lstat(configFile);if(!stat.isFile()||stat.size>64000)throw Error('TEAM_ADAPTER_CONFIG_INVALID');
  const config=JSON.parse(await readFile(configFile,'utf8'));
  if(config.version!==1||!Array.isArray(config.adapters)||config.adapters.length>10)throw Error('TEAM_ADAPTER_CONFIG_INVALID');
  const transports:AgentRuntimeTransport[]=[],anchors:TrustAnchor[]=[];
  for(const entry of config.adapters) {
    if(entry.kind==='native-service') {
      if(typeof entry.id!=='string'||!isAbsolute(entry.socketPath??'')||typeof entry.publicKey!=='string'||!/^[a-f0-9]{64}$/.test(entry.moduleDigest))throw Error('TEAM_NATIVE_ADAPTER_CONFIG_INVALID');
      transports.push(nativeTransportClient(entry));anchors.push({transportId:entry.id,mode:'live',publicKey:entry.publicKey,moduleDigest:entry.moduleDigest});continue;
    }
    if(typeof entry.id!=='string'||!isAbsolute(entry.module)||!/^[a-f0-9]{64}$/.test(entry.sha256)||typeof entry.publicKey!=='string')throw Error('TEAM_ADAPTER_CONFIG_INVALID');
    const stat=await lstat(entry.module);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2_000_000)throw Error('TEAM_ADAPTER_MODULE_INVALID');
    const bytes=await readFile(entry.module);if(bytesDigest(bytes)!==entry.sha256)throw Error('TEAM_ADAPTER_MODULE_DIGEST_MISMATCH');
    // Import the exact verified bytes, eliminating replacement between hash and import.
    const module=await import('data:text/javascript;base64,'+bytes.toString('base64'));
    const transport:AgentRuntimeTransport=await module.createTransport();
    if(transport.id!==entry.id||transport.mode!=='live'||!transport.support||['discover','send','reconcile','collect'].some(k=>typeof (transport as any)[k]!=='function'))throw Error('TEAM_ADAPTER_INTERFACE_INVALID');
    transports.push(transport);anchors.push({transportId:entry.id,mode:'live',publicKey:entry.publicKey,moduleDigest:entry.sha256});
  }
  return new AgentRuntimeRegistry(transports,anchors);
}
