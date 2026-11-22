import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';

export interface RpcPeer {
  request(method:string,params:unknown,signal?:AbortSignal):Promise<any>;
  notify(method:string,params:unknown):void;
  onEvent(listener:(method:string,params:any)=>void):()=>void;
  close():void;
}
/** Dedicated public App Server stdio channel. No socket discovery or external terminal access. */
export class CodexStdio implements RpcPeer {
  private child:ChildProcessWithoutNullStreams;
  private events=new EventEmitter();
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;cleanup:()=>void}>();
  private sequence=0;private buffer='';private closed=false;
  constructor(executable:string,cwd:string) {
    this.child=spawn(executable,['app-server','--listen','stdio://'],{cwd,shell:false,stdio:['pipe','pipe','pipe']});
    const decoder=new StringDecoder('utf8');
    this.child.stdout.on('data',(bytes:Buffer)=>{
      this.buffer+=decoder.write(bytes);
      if(Buffer.byteLength(this.buffer)>10_000_000){this.fail(Error('CODEX_FRAME_LIMIT'));return;}
      let newline:number;
      while((newline=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);if(line.trim())this.frame(line);}
    });
    this.child.stderr.resume(); // Do not persist logs, credentials or unrelated terminal content.
    this.child.on('error',()=>this.fail(Error('CODEX_PROCESS_UNAVAILABLE')));
    this.child.on('close',()=>this.fail(Error('CODEX_CHANNEL_CLOSED')));
    this.child.stdin.on('error',()=>this.fail(Error('CODEX_CHANNEL_CLOSED')));
  }
  private frame(line:string) {
    try {
      const message=JSON.parse(line);
      if(message.method&&message.id!==undefined) {
        // Server-side tools, auth handoffs and approvals are never automatically granted.
        this.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Migration Maestro denies server requests'}})+'\n');
        this.events.emit('event','maestro/server-request-denied',{method:message.method});return;
      }
      if(typeof message.method==='string') {this.events.emit('event',message.method,message.params);return;}
      const entry=this.pending.get(message.id);
      if(!entry)return; // A timed-out request can have a late response; never treat it as a new request.
      this.pending.delete(message.id);entry.cleanup();
      if(message.error)entry.reject(Error('CODEX_RPC_ERROR_'+String(message.error.code)));
      else if(message.result===undefined)entry.reject(Error('CODEX_RPC_RESPONSE_INVALID'));
      else entry.resolve(message.result);
    }catch{this.fail(Error('CODEX_PROTOCOL_INVALID'));}
  }
  private fail(error:Error) {
    if(this.closed)return;this.closed=true;
    for(const entry of this.pending.values()){entry.cleanup();entry.reject(error);}this.pending.clear();
    this.events.emit('event','maestro/channel-closed',{reason:error.message});this.child.kill();
  }
  request(method:string,params:unknown,signal?:AbortSignal):Promise<any> {
    if(this.closed||signal?.aborted)return Promise.reject(Error('CODEX_CHANNEL_UNAVAILABLE'));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.pending.delete(id);cleanup();reject(Error('CODEX_REQUEST_ABORTED_OUTCOME_UNKNOWN'));};
      const timer=setTimeout(()=>{this.pending.delete(id);cleanup();reject(Error('CODEX_REQUEST_TIMEOUT_OUTCOME_UNKNOWN'));},15000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      signal?.addEventListener('abort',abort,{once:true});this.pending.set(id,{resolve,reject,cleanup});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  notify(method:string,params:unknown) {if(this.closed)throw Error('CODEX_CHANNEL_CLOSED');this.child.stdin.write(JSON.stringify({method,params})+'\n');}
  onEvent(listener:(method:string,params:any)=>void) {this.events.on('event',listener);return ()=>this.events.off('event',listener);}
  close(){this.fail(Error('CODEX_CHANNEL_CLOSED'));}
}
