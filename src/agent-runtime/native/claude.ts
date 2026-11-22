import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { digest } from '../contracts.js';
import { RuntimeJournal } from '../journal.js';
import { nativeOutputSchema,type NativeDriver,type NativeObservation,type NativeAcceptance,type NativeCompletion } from './types.js';

/** Public SDK subset used by the executable adapter. Keeping structural types permits an
 * optional SDK installation; it does not replace the official package at runtime. */
export interface ClaudeSdk {
  query(input:{prompt:AsyncIterable<any>;options:Record<string,unknown>}):AsyncIterable<any>&{close():void};
  listSessions(options:{dir:string;limit:number}):Promise<{sessionId:string}[]>;
}
export async function loadClaudeSdk(root?:string):Promise<ClaudeSdk> {
  try {
    const require=createRequire(root?join(root,'package.json'):import.meta.url);
    const resolved=require.resolve('@anthropic-ai/claude-agent-sdk');
    const sdk=await import(pathToFileURL(resolved).href);
    if(typeof sdk.query!=='function'||typeof sdk.listSessions!=='function')throw Error('CLAUDE_SDK_INTERFACE_UNSUPPORTED');
    return sdk;
  }catch(e){if(e instanceof Error&&e.message==='CLAUDE_SDK_INTERFACE_UNSUPPORTED')throw e;throw Error('CLAUDE_AGENT_SDK_NOT_INSTALLED');}
}
class Inputs implements AsyncIterable<any> {
  private values:any[]=[];private waiter:((v:IteratorResult<any>)=>void)|undefined;private ended=false;
  push(value:any){if(this.ended)throw Error('CLAUDE_INPUT_CLOSED');if(this.waiter){const w=this.waiter;this.waiter=undefined;w({value,done:false});}else this.values.push(value);}
  close(){this.ended=true;this.waiter?.({value:undefined,done:true});this.waiter=undefined;}
  [Symbol.asyncIterator](){return {next:():Promise<IteratorResult<any>>=>this.values.length?Promise.resolve({value:this.values.shift(),done:false}):this.ended?Promise.resolve({value:undefined,done:true}):new Promise(resolve=>{this.waiter=resolve;})};}
}
type Owned={observation:NativeObservation;input:Inputs;query:ReturnType<ClaudeSdk['query']>;failure?:string;active?:string};
/** Official Agent SDK streaming input: no CLI text scraping and no resume of external sessions. */
export class ClaudeAgentSdkDriver implements NativeDriver {
  readonly provider='claude-code' as const;
  private epoch=randomUUID();private owned=new Map<string,Owned>();private starting=new Set<Owned>();private journal:RuntimeJournal;
  constructor(private sdk:ClaudeSdk,private options:{cwd:string;stateDirectory:string;executable?:string}) {this.journal=new RuntimeJournal(options.stateDirectory);}
  async inspect(_signal:AbortSignal) {
    const result:NativeObservation[]=[...this.owned.values()].map(s=>({...s.observation,available:!s.failure}));
    const files=await readdir(this.options.stateDirectory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    for(const file of files)if(/^session-[a-f0-9]{64}\.json$/.test(file)) {
      const recorded=await this.journal.read<NativeObservation>(file);
      if(recorded&&!this.owned.has(recorded.sessionId))result.push({...recorded,ownership:'managed-detached',available:false,scopeEnforced:false,diagnostics:['MANAGED_SESSION_REQUIRES_EXPLICIT_RECOVERY']});
    }
    for(const session of await this.sdk.listSessions({dir:this.options.cwd,limit:100}))if(!result.some(o=>o.sessionId===session.sessionId))result.push({provider:this.provider,agentId:null,sessionId:session.sessionId,connectionId:null,ownership:'external',modelId:null,available:false,scopeEnforced:false,protocolCapabilities:[],diagnostics:['EXTERNAL_SESSION_NOT_CONTROLLED']});
    return result;
  }
  async prepare(agentId:string,modelId:string,signal:AbortSignal):Promise<NativeObservation> {
    await this.journal.initialize();
    const old=[...this.owned.values()].find(s=>s.observation.agentId===agentId);
    if(old){if(old.observation.modelId!==modelId)throw Error('CLAUDE_OWNED_MODEL_CONFLICT');return {...old.observation,available:!old.failure};}
    await this.journal.write('prepare-'+digest(agentId)+'.claim.json',{agentId,modelId,connectionId:this.epoch},true);
    const input=new Inputs();
    const query=this.sdk.query({prompt:input,options:{cwd:this.options.cwd,model:modelId,tools:[],allowedTools:[],mcpServers:{},plugins:[],settingSources:[],permissionMode:'dontAsk',
      canUseTool:async()=>({behavior:'deny',message:'Migration Maestro permits structured artifacts only'}),
      includePartialMessages:true,maxTurns:1,outputFormat:{type:'json_schema',schema:nativeOutputSchema},
      ...(this.options.executable?{pathToClaudeCodeExecutable:this.options.executable}:{}),
    }});
    let initialized:(value:NativeObservation)=>void=()=>{},failed:(error:Error)=>void=()=>{};
    const ready=new Promise<NativeObservation>((resolve,reject)=>{initialized=resolve;failed=reject;});
    const owned:Owned={input,query,observation:{provider:this.provider,agentId,sessionId:'',connectionId:this.epoch,ownership:'managed',modelId:null,available:false,scopeEnforced:false,protocolCapabilities:[],diagnostics:['SEMANTIC_CAPABILITY_EVIDENCE_REQUIRED','PROFILE_POLICY_EVIDENCE_REQUIRED']}};
    this.starting.add(owned);
    const abort=()=>{owned.failure='CLAUDE_INITIALIZATION_CANCELLED';input.close();query.close();failed(Error(owned.failure));};
    const timer=setTimeout(()=>{owned.failure='CLAUDE_INIT_NOT_OBSERVED_WITHOUT_PROMPT';input.close();query.close();failed(Error(owned.failure));},10000);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    void (async()=>{
      try {
        for await(const event of query) {
          if(event.type==='system'&&event.subtype==='init') {
            if(owned.observation.sessionId||typeof event.session_id!=='string'||event.model!==modelId||event.cwd!==this.options.cwd||event.permissionMode!=='dontAsk'||!Array.isArray(event.tools)||event.tools.length||!Array.isArray(event.mcp_servers)||event.mcp_servers.length||!Array.isArray(event.plugins)||event.plugins.length)throw Error('CLAUDE_EFFECTIVE_SESSION_POLICY_UNVERIFIED');
            owned.observation={...owned.observation,sessionId:event.session_id,modelId:event.model,available:true,scopeEnforced:true,protocolCapabilities:Array.isArray(event.capabilities)?event.capabilities.filter((c:unknown)=>typeof c==='string'):[]};
            await this.journal.write('session-'+digest(event.session_id)+'.json',{...owned.observation,createdAt:new Date().toISOString()},true);
            this.owned.set(event.session_id,owned);this.starting.delete(owned);initialized(structuredClone(owned.observation));
          } else await this.event(owned,event);
        }
        owned.failure='CLAUDE_STREAM_CLOSED';failed(Error(owned.failure));
      }catch(e){owned.failure=e instanceof Error?e.message:'CLAUDE_SDK_FAILED';failed(Error(owned.failure));input.close();query.close();}
    })();
    try{return await ready;}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);this.starting.delete(owned);}
  }
  private async event(owned:Owned,event:any) {
    if(!owned.active)return;
    const requestId=owned.active,sessionId=owned.observation.sessionId;
    if(event.session_id&&event.session_id!==sessionId)throw Error('CLAUDE_EVENT_SESSION_MISMATCH');
    if(event.parent_tool_use_id||event.agent_id)throw Error('CLAUDE_UNEXPECTED_SUBAGENT');
    if(event.type==='assistant'&&(event.message?.content??[]).some((c:any)=>c.type==='tool_use'))throw Error('CLAUDE_UNEXPECTED_TOOL');
    if(event.type==='assistant'&&event.message?.model!==owned.observation.modelId)throw Error('CLAUDE_MODEL_CHANGED');
    const correlated=event.user_message_uuid===requestId;
    const responseEvent=event.type==='assistant'||event.type==='stream_event'&&event.event?.type==='message_start'||event.type==='result';
    if(responseEvent&&correlated) {
      if(typeof event.uuid!=='string')throw Error('CLAUDE_EVENT_ID_REQUIRED');
      const existing=await this.journal.read<NativeAcceptance>('acceptance-'+requestId+'.json');
      if(!existing)await this.journal.write('acceptance-'+requestId+'.json',{sessionId,requestId,turnId:event.uuid,eventDigest:digest(event)},true);
    }
    if(event.type!=='result')return;
    if(!correlated||event.subtype!=='success'||event.is_error!==false||event.structured_output===undefined||event.local_command||
      event.permission_denials?.length||!event.modelUsage||!Object.keys(event.modelUsage).length||Object.keys(event.modelUsage).some(m=>m!==owned.observation.modelId))throw Error('CLAUDE_RESULT_NOT_VERIFIED');
    const acceptance=await this.journal.read<NativeAcceptance>('acceptance-'+requestId+'.json');if(!acceptance)throw Error('CLAUDE_ACCEPTANCE_MISSING');
    const completion:NativeCompletion={...acceptance,status:'completed',output:event.structured_output,modelId:owned.observation.modelId!,eventDigest:digest(event)};
    await this.journal.write('completion-'+requestId+'.json',completion,true);owned.active=undefined;
  }
  async execute(sessionId:string,requestId:string,prompt:string,signal:AbortSignal) {
    const owned=this.owned.get(sessionId);if(!owned||owned.failure)throw Error('CLAUDE_OWNED_SESSION_REQUIRED');
    if(owned.active)throw Error('CLAUDE_SESSION_BUSY');
    await this.journal.write('request-'+requestId+'.json',{sessionId,requestId,promptDigest:digest(prompt),connectionId:this.epoch},true);
    owned.active=requestId;owned.input.push({type:'user',uuid:requestId,session_id:sessionId,parent_tool_use_id:null,message:{role:'user',content:prompt}});
    // A provider-correlated event is required; writing stdin or receiving init is not delivery.
    while(!signal.aborted) {
      if(owned.failure)throw Error(owned.failure);
      const accepted=await this.reconcile(sessionId,requestId,signal);if(accepted)return accepted;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('CLAUDE_DELIVERY_PENDING_RECONCILE_ONLY');
  }
  async reconcile(sessionId:string,requestId:string,_signal:AbortSignal) {
    const value=await this.journal.read<NativeAcceptance>('acceptance-'+requestId+'.json');if(value&&value.sessionId!==sessionId)throw Error('CLAUDE_RECONCILIATION_BINDING_INVALID');return value??null;
  }
  async collect(sessionId:string,requestId:string,signal:AbortSignal) {
    await this.reconcile(sessionId,requestId,signal);const value=await this.journal.read<NativeCompletion>('completion-'+requestId+'.json');
    if(value&&value.sessionId!==sessionId)throw Error('CLAUDE_RESULT_BINDING_INVALID');return value??null;
  }
  close(){for(const s of [...this.owned.values(),...this.starting]){s.failure='CLAUDE_DRIVER_CLOSED';s.input.close();s.query.close();}}
}
