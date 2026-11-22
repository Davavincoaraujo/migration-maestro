import { randomUUID } from 'node:crypto';
import { validateResult, type StageResultV2 } from '../autopilot/central-controller.js';
import { AgentRuntimeRegistry } from './registry.js';
import { RuntimeJournal } from './journal.js';
import { checkDelivery, type DeliveryRecord } from './dispatcher.js';
import { bounded,bytesDigest,digest,verifyEvidence,type CollectedResult,type RuntimeTask,type SignedEvidence } from './contracts.js';

export interface ResultCheckpoint { requestDigest:string;resultDigest:string;proof:SignedEvidence<CollectedResult>;verifiedAt:number; }
const outputKey={ANALYZE:'inventory',DISCOVER_COMPONENTS:'components',MAP_COMPONENTS:'mappings',PLAN:'steps',IMPLEMENT:'files',VALIDATE:'checks'} as const;
export function stageOutputInstructions(stage:RuntimeTask['stage']):string {
  return `Return a StageResultV2 object: {version:2,jobId,taskId,stage,status:"completed",summary:nonempty string,evidence:nonempty string array,artifacts:[{file,digest:SHA256 of exact artifact bytes}]}. Return artifact bytes separately as canonical base64. Include ${stage}.output.json with {version:1,jobId,taskId,stage,inputs:exact request.inputs,${outputKey[stage]}:nonempty string array,limitations:string array${stage==='VALIDATE'?',passed:true only if checks pass':''}}. Do not claim completion if the stage cannot be completed; describe limitations in the output. All IDs must match the request.`;
}
/** Uniform stage handoff. Semantics/quality beyond this structural contract require domain review. */
export function validateCollectedResult(value:CollectedResult,task:RuntimeTask,receiptId:string) {
  checkDelivery(value,task);
  if(value.receiptId!==receiptId)throw Error('RUNTIME_RESULT_RECEIPT_MISMATCH');
  const result=validateResult(JSON.stringify(value.result),task.stage,task.taskId,{jobId:task.jobId,resultContractVersion:2}) as StageResultV2;
  if(!Array.isArray(value.artifacts)||value.artifacts.length!==result.artifacts.length)throw Error('RUNTIME_ARTIFACT_SET_INVALID');
  const artifacts=new Map<string,Buffer>();let size=0;
  for(const artifact of value.artifacts) {
    if(typeof artifact.bytesBase64!=='string'||artifact.bytesBase64.length>7_000_000||artifacts.has(artifact.file))throw Error('RUNTIME_ARTIFACT_INVALID');
    const bytes=Buffer.from(artifact.bytesBase64,'base64');size+=bytes.length;
    if(size>5_000_000||bytes.toString('base64')!==artifact.bytesBase64||!result.artifacts.some(a=>a.file===artifact.file&&a.digest===bytesDigest(bytes)))throw Error('RUNTIME_ARTIFACT_INTEGRITY_FAILED');
    artifacts.set(artifact.file,bytes);
  }
  const output=artifacts.get(task.stage+'.output.json');
  if(!output)throw Error('RUNTIME_STAGE_OUTPUT_REQUIRED');
  const handoff=JSON.parse(output.toString('utf8'));
  if(handoff.version!==1||handoff.stage!==task.stage||handoff.jobId!==task.jobId||handoff.taskId!==task.taskId||
    digest(handoff.inputs)!==digest(task.inputs)||!Array.isArray(handoff[outputKey[task.stage]])||!handoff[outputKey[task.stage]].length||
    handoff[outputKey[task.stage]].some((x:unknown)=>typeof x!=='string'||!x.trim()||x.length>2000)||
    !Array.isArray(handoff.limitations)||handoff.limitations.some((x:unknown)=>typeof x!=='string'))throw Error('RUNTIME_STAGE_CONTRACT_INVALID');
  if(task.stage==='VALIDATE'&&handoff.passed!==true)throw Error('RUNTIME_VALIDATION_FAILED');
  return {result,artifacts};
}
export class ResultCollector {
  constructor(private registry:AgentRuntimeRegistry,private journal:RuntimeJournal) {}
  async verifyCheckpoint(task:RuntimeTask,record:ResultCheckpoint,delivery:DeliveryRecord) {
    const {anchor}=this.registry.transport(task.session.transportId);
    if(record.requestDigest!==digest(task)||record.resultDigest!==digest(record.proof.payload))throw Error('RUNTIME_CHECKPOINT_MISMATCH');
    checkDelivery(verifyEvidence(delivery.proof,anchor,'delivery',delivery.proof.challenge,delivery.verifiedAt),task);
    const value=verifyEvidence(record.proof,anchor,'result',record.proof.challenge,record.verifiedAt);
    validateCollectedResult(value,task,delivery.proof.payload.receiptId);
    return record;
  }
  async collect(task:RuntimeTask,delivery:DeliveryRecord):Promise<ResultCheckpoint|undefined> {
    const {anchor:deliveryAnchor}=this.registry.transport(task.session.transportId);
    if(digest(delivery.request)!==digest(task))throw Error('RUNTIME_DELIVERY_BINDING_INVALID');
    checkDelivery(verifyEvidence(delivery.proof,deliveryAnchor,'delivery',delivery.proof.challenge,delivery.verifiedAt),task);
    const existing=await this.journal.read<ResultCheckpoint>(task.stage+'.checkpoint.json');
    if(existing)return this.verifyCheckpoint(task,existing,delivery);
    const {transport,anchor}=this.registry.assertSession(task.session),challenge=randomUUID();
    const proof=await bounded(signal=>transport.collect(structuredClone(task),challenge,signal));
    if(!proof)return;
    const verifiedAt=Date.now(),value=verifyEvidence(proof,anchor,'result',challenge,verifiedAt);
    validateCollectedResult(value,task,delivery.proof.payload.receiptId);
    const checkpoint={requestDigest:digest(task),resultDigest:digest(value),proof,verifiedAt};
    // Artifacts are stored as signed bytes inside checkpoint; never write agent-selected paths or execute them.
    await this.journal.write(task.stage+'.checkpoint.json',checkpoint,true);
    return checkpoint;
  }
}
