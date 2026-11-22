import { digest } from '../contracts.js';
import type { RuntimeTask } from '../contracts.js';
import type { NativeAgentTransport } from './transport.js';
import { NativeAdmissionFence, admissionPolicy, type NativeOperation, type OperationIdentity } from './admission.js';

type Transport=Pick<NativeAgentTransport,'prepare'|'observations'|'cachedObservations'|'sign'|'discover'|'send'|'reconcile'|'collect'>;
interface Provider {id:string;roles:{agentId:string;modelId:string}[];}
/** Single admission route used by every public provider IPC operation. */
export class NativeAdmissionDispatcher {
  private queues=new Map<string,Promise<unknown>>();
  constructor(private fence:NativeAdmissionFence,private providers:Provider[],
    private create:(id:string)=>Promise<Transport>,private existing:(id:string)=>Transport|undefined,
    private persistedObservation?:(id:string,challenge:string)=>Promise<unknown>) {}
  async dispatch(message:{transportId:string;method:string;params:any}) {
    const method=message.method as NativeOperation,params=message.params;
    if(!Object.hasOwn(admissionPolicy,method))throw Error('NATIVE_IPC_METHOD_INVALID');
    if(method==='prepare'&&params?.authorizeSessionCreation!==true)throw Error('NATIVE_SESSION_CREATION_AUTHORIZATION_REQUIRED');
    const provider=this.providers.find(p=>p.id===message.transportId);
    if(!provider)throw Error('NATIVE_PROVIDER_UNKNOWN');
    const role=method==='prepare'?provider.roles.find(r=>r.agentId===params?.agentId):undefined;
    if(method==='prepare'&&!role)throw Error('NATIVE_ROLE_NOT_CONFIGURED');
    if(method!=='prepare'&&(typeof params?.challenge!=='string'||params.challenge.length>100))throw Error('NATIVE_CHALLENGE_REQUIRED');
    const task=params?.task as RuntimeTask|undefined;
    if(['send','reconcile','collect'].includes(method)&&(!task||typeof task.taskId!=='string'||!task.session?.sessionId))
      throw Error('NATIVE_TASK_REQUIRED');
    const identity:OperationIdentity={providerId:provider.id,
      ...(role?{agentId:role.agentId}:{}),
      ...(task?{taskId:task.taskId,taskDigest:digest(task),sessionId:task.session.sessionId}:{})};
    if(this.fence.draining&&method==='observe') {
      const transport=this.existing(provider.id);
      if(!transport){
        if(this.persistedObservation)return this.persistedObservation(provider.id,params.challenge);
        throw Error('NATIVE_DRAINING_PROVIDER_NOT_LOADED');
      }
      return transport.sign('session',transport.cachedObservations(),params.challenge);
    }
    // reconcile/collect never lazily start a provider, even when OPEN.
    if(['reconcile','collect'].includes(method)&&!this.existing(provider.id))
      throw Error('NATIVE_RECONCILIATION_PROVIDER_NOT_LOADED');
    const work=async()=>{
      const previous=this.queues.get(provider.id)??Promise.resolve();
      const operation=previous.catch(()=>{}).then(async()=>{
        const transport=this.existing(provider.id)??await this.create(provider.id);
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
        try {
          // Await inside try: do not clear timeout before provider operation settles.
          if(method==='prepare')return await transport.prepare(role!.agentId,role!.modelId,controller.signal);
          if(method==='observe')return transport.sign('session',await transport.observations(controller.signal),params.challenge);
          if(method==='discover')return await transport.discover(params.challenge,controller.signal);
          const result=await transport[method](task!,params.challenge,controller.signal);
          if(method==='collect'&&result!==null)await this.fence.collected(identity,result);
          return result;
        }finally{clearTimeout(timer);}
      });
      this.queues.set(provider.id,operation);return operation;
    };
    // Reservation occurs BEFORE provider queueing. A request admitted before drain
    // may finish afterwards; requests racing behind the fence never enter work().
    return this.fence.execute(method,identity,work);
  }
}
