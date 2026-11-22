import { randomUUID } from 'node:crypto';
import { AgentRuntimeRegistry } from './registry.js';
import { RuntimeJournal } from './journal.js';
import { bounded,digest,verifyEvidence,type Delivery,type RuntimeTask,type SignedEvidence } from './contracts.js';
export interface DeliveryRecord { request:RuntimeTask;proof:SignedEvidence<Delivery>;verifiedAt:number; }
export function checkDelivery(receipt:Delivery,task:RuntimeTask) {
  if(receipt?.accepted!==true||receipt.taskId!==task.taskId||receipt.requestDigest!==digest(task)||receipt.sessionDigest!==digest(task.session)||
    typeof receipt.receiptId!=='string'||!receipt.receiptId.trim()||receipt.receiptId.length>200)throw Error('RUNTIME_DELIVERY_BINDING_INVALID');
}
export class TaskDispatcher {
  constructor(private registry:AgentRuntimeRegistry,private journal:RuntimeJournal,private authorize:(task:RuntimeTask)=>Promise<void>) {}
  async dispatch(task:RuntimeTask):Promise<DeliveryRecord|undefined> {
    await this.authorize(task);
    const frozen=structuredClone(task);
    const claimName=task.stage+'.claim.json';
    const prior=await this.journal.read<{request:RuntimeTask}>(claimName);
    if(prior&&digest(prior.request)!==digest(frozen))throw Error('RUNTIME_TASK_CONFLICT');
    const {transport,anchor}=this.registry.assertSession(frozen.session);
    const existing=await this.journal.read<DeliveryRecord>(task.stage+'.delivery.json');
    if(existing) {
      if(!prior)throw Error('RUNTIME_CLAIM_REQUIRED');
      if(digest(existing.request)!==digest(frozen))throw Error('RUNTIME_TASK_CONFLICT');
      checkDelivery(verifyEvidence(existing.proof,anchor,'delivery',existing.proof.challenge,existing.verifiedAt),frozen);
      return existing;
    }
    const challenge=randomUUID();
    // Persist before calling transport. Even a timeout cannot prove non-delivery.
    if(!prior)await this.journal.write(claimName,{request:frozen,claimedAt:new Date().toISOString()},true);
    try {
      await this.authorize(frozen);this.registry.assertSession(frozen.session);
      const proof=await bounded(signal=>prior?transport.reconcile(structuredClone(frozen),challenge,signal):transport.send(structuredClone(frozen),challenge,signal));
      if(!proof)throw Error('RUNTIME_DELIVERY_UNCONFIRMED');
      const verifiedAt=Date.now();checkDelivery(verifyEvidence(proof,anchor,'delivery',challenge,verifiedAt),frozen);
      const record={request:frozen,proof,verifiedAt};
      await this.journal.write(task.stage+'.delivery.json',record,true);
      return record;
    } catch(e) {
      await this.journal.write(task.stage+'.reconciliation-'+randomUUID()+'.json',{requestDigest:digest(frozen),at:new Date().toISOString(),outcome:'unknown',deliveryVerified:false,
        reason:e instanceof Error?e.message:'RUNTIME_DELIVERY_UNKNOWN'} ,true);
      return;
    }
  }
}
