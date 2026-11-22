import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { verifyEvidence,type AgentRuntimeTransport,type TrustAnchor,type RuntimeTask } from '../contracts.js';

export interface NativeEndpoint {id:string;socketPath:string;publicKey:string;moduleDigest:string;}
/** This is Migration Maestro's own documented IPC endpoint, not a provider/private Maestri socket. */
export function nativeRequest(endpoint:NativeEndpoint,method:string,params:unknown,signal:AbortSignal):Promise<any> {
  if(signal.aborted)return Promise.reject(Error('NATIVE_IPC_ABORTED'));
  return new Promise((resolve,reject)=>{
    const socket=connect(endpoint.socketPath);let bytes=Buffer.alloc(0),settled=false;
    const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value);};
    const abort=()=>finish(Error('NATIVE_IPC_ABORTED_OUTCOME_UNKNOWN'));
    const timer=setTimeout(()=>finish(Error('NATIVE_IPC_TIMEOUT_OUTCOME_UNKNOWN')),20000);
    signal.addEventListener('abort',abort,{once:true});
    socket.on('connect',()=>socket.write(JSON.stringify({version:1,transportId:endpoint.id,method,params})+'\n'));
    socket.on('data',(chunk:Buffer)=>{
      bytes=Buffer.concat([bytes,chunk]);if(bytes.length>10_000_000)return finish(Error('NATIVE_IPC_SIZE_LIMIT'));
      const newline=bytes.indexOf(10);if(newline<0)return;
      try{const reply=JSON.parse(bytes.subarray(0,newline).toString('utf8'));if(reply.error)finish(Error(reply.error));else finish(undefined,reply.result);}catch{finish(Error('NATIVE_IPC_INVALID_RESPONSE'));}
    });
    socket.on('error',()=>finish(Error('NATIVE_SERVICE_UNAVAILABLE')));socket.on('end',()=>finish(Error('NATIVE_IPC_CLOSED')));
  });
}
export function nativeTransportClient(endpoint:NativeEndpoint):AgentRuntimeTransport & {observations(signal:AbortSignal):Promise<unknown[]>;close():void} {
  const anchor:TrustAnchor={transportId:endpoint.id,mode:'live',publicKey:endpoint.publicKey,moduleDigest:endpoint.moduleDigest};
  const taskCall=(method:string,task:RuntimeTask,challenge:string,signal:AbortSignal)=>nativeRequest(endpoint,method,{task,challenge},signal);
  return {id:endpoint.id,mode:'live',support:{discovery:true,sessionBoundDispatch:true,reconciliation:true,results:true},
    discover:(challenge,signal)=>nativeRequest(endpoint,'discover',{challenge},signal),
    send:(task,challenge,signal)=>taskCall('send',task,challenge,signal),
    reconcile:(task,challenge,signal)=>taskCall('reconcile',task,challenge,signal),
    collect:(task,challenge,signal)=>taskCall('collect',task,challenge,signal),
    observations:async signal=>{const challenge=randomUUID(),proof=await nativeRequest(endpoint,'observe',{challenge},signal);return verifyEvidence<unknown[]>(proof,anchor,'session',challenge);},
    close:()=>{},
  };
}
