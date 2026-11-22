import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, link, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dispatchDigest } from './dispatch-executor.js';
import { readOperationalJson } from './operational-run.js';
import { reconcileOperational, snapshotOperational } from './operational-reconcile.js';

export const continuationStages = ['ANALYZE', 'MAP_COMPONENTS', 'PLAN'] as const;
export type ContinuationStage = typeof continuationStages[number];
export interface ContinuationAuthorization {
  version: 1; kind: 'synthetic-continuation-authorization'; jobId: string;
  recoveryDigest: string; policyDigest: string; operator: string; issuedAt: string; expiresAt: string;
  scope: 'isolated-synthetic'; reuseLocalAnalyticsProbe: true;
  dispatchStages: ContinuationStage[]; capabilityProbeAgents: string[];
  planOnly: true; implementAuthorized: false; resendAuthorized: false;
  deliveryAuthenticated: false; authorshipAuthenticated: false;
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export function continuationPaths(directory: string, id: string) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw Error('INVALID_OPERATIONAL_ID');
  const base = resolve(directory);
  return { base, root: join(base,id), authorization: join(base,'continuation-authorizations',id+'.json'),
    executionBase: join(base,'continuations'), executionRoot: join(base,'continuations',id) };
}
export async function regularDirectory(path: string) {
  if (!(await lstat(path)).isDirectory()) throw Error('INVALID_CONTINUATION_DIRECTORY');
}
export async function optionalRecord(path: string) {
  try { return await readOperationalJson(path); }
  catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
/** Reconstruct the entire recovery contract from current immutable source bytes. No writes. */
export async function inspectContinuationRecovery(directory: string, id: string) {
  const {base,root} = continuationPaths(directory,id);
  await regularDirectory(base); await regularDirectory(root);
  const before = await snapshotOperational(root);
  const recoveryBytes = await readFile(join(root,'analytics-probe-recovery.json'));
  const recovery = await readOperationalJson(join(root,'analytics-probe-recovery.json'));
  const operation = await readOperationalJson(join(root,'operation.json'));
  const report = await reconcileOperational(base,id);
  const probes = report.evidence.filter(e=>e.kind==='probe' && e.agentId==='Analytics');
  if (operation.kind !== 'pipeline' || operation.planOnly !== true || operation.policy.scope !== 'isolated-synthetic' ||
      !report.recordsStable || report.state !== 'local-evidence-valid' || report.pending.length ||
      report.evidence.length !== 1 || probes.length !== 1 || probes[0].state !== 'local-result-valid' ||
      probes[0].provenance !== 'digest-verified' || probes[0].proofPresent ||
      report.checkpoint?.state !== 'failed' || report.checkpoint.completed.length) throw Error('CONTINUATION_RECOVERY_INELIGIBLE');
  const probe = probes[0], prefix = `probes/${probe.key}/`;
  const task = await readOperationalJson(join(root,prefix,'CAPABILITY.task.json'));
  const receipt = await readOperationalJson(join(root,prefix,'CAPABILITY.dispatch-receipt.json'));
  if (receipt.outcome !== 'unknown' || receipt.deliveryVerified !== false) throw Error('CONTINUATION_ORIGINAL_OUTCOME_CHANGED');
  const files = Object.fromEntries(Object.entries(before).filter(([k,v])=>k!=='analytics-probe-recovery.json' && v!=='directory').map(([k,v])=>[k,v.split(':').at(-1)]));
  const expected = {version:1,kind:'local-reconciled-probe',jobId:id,agentId:'Analytics',probeId:probe.key,
    taskId:task.taskId,nonce:task.nonce,planOnly:true,confirmedSynthetic:true,
    policy:operation.policy,policyDigest:dispatchDigest(operation.policy),requestDigest:task.requestDigest,
    routeDigest:task.routeDigest,resultDigest:probe.resultDigest,files,
    originalDispatch:{outcome:'unknown',deliveryVerified:false},deliveryAuthenticated:false,authorshipAuthenticated:false,
    analyzeCompleted:false,resendAuthorized:false,pipelineAdvanceAuthorized:false,humanAuthorizationRequired:true};
  if (dispatchDigest(recovery)!==dispatchDigest(expected)) throw Error('CONTINUATION_RECOVERY_MISMATCH');
  if (JSON.stringify(before)!==JSON.stringify(await snapshotOperational(root))) throw Error('CONTINUATION_EVIDENCE_CHANGED');
  return {recovery,operation,recoveryDigest:hash(recoveryBytes),report};
}
function validateAuthorization(a: ContinuationAuthorization, r: Awaited<ReturnType<typeof inspectContinuationRecovery>>, id: string, now: number) {
  if (!a || typeof a !== 'object') throw Error('CONTINUATION_AUTHORIZATION_REQUIRED');
  const expected = {version:1,kind:'synthetic-continuation-authorization',jobId:id,recoveryDigest:r.recoveryDigest,
    policyDigest:r.recovery.policyDigest,operator:a.operator,issuedAt:a.issuedAt,expiresAt:a.expiresAt,
    scope:'isolated-synthetic',reuseLocalAnalyticsProbe:true,dispatchStages:a.dispatchStages,capabilityProbeAgents:a.capabilityProbeAgents,
    planOnly:true,implementAuthorized:false,resendAuthorized:false,deliveryAuthenticated:false,authorshipAuthenticated:false};
  const issued = Date.parse(a.issuedAt), expires = Date.parse(a.expiresAt);
  if (dispatchDigest(a)!==dispatchDigest(expected) || typeof a.operator!=='string' || typeof a.issuedAt!=='string' || typeof a.expiresAt!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.@ -]{0,99}$/.test(a.operator) ||
      !Number.isFinite(issued) || !Number.isFinite(expires) || issued>now || expires<=now || expires<=issued || expires-issued>86400000 ||
      !Array.isArray(a.dispatchStages) || a.dispatchStages.length>3 || a.dispatchStages.some((s,i)=>s!==continuationStages[i]) ||
      !Array.isArray(a.capabilityProbeAgents) || new Set(a.capabilityProbeAgents).size!==a.capabilityProbeAgents.length ||
      a.capabilityProbeAgents.some(agent=>!['UE-Pattern','Hermes'].includes(agent) || !r.operation.policy.agents.some((v:any)=>v.agentId===agent))) {
    throw Error('INVALID_CONTINUATION_AUTHORIZATION');
  }
}
export async function inspectContinuationAuthorization(directory: string, id: string, now=Date.now()) {
  const recovery = await inspectContinuationRecovery(directory,id);
  const p = continuationPaths(directory,id);
  await regularDirectory(join(p.base,'continuation-authorizations')).catch(e=>{if(e.code==='ENOENT') throw Error('CONTINUATION_AUTHORIZATION_REQUIRED');throw e;});
  const authorizationBytes = await readFile(p.authorization).catch(e=>{if(e.code==='ENOENT')throw Error('CONTINUATION_AUTHORIZATION_REQUIRED');throw e;});
  const authorization = await optionalRecord(p.authorization) as ContinuationAuthorization | undefined;
  if (!authorization) throw Error('CONTINUATION_AUTHORIZATION_REQUIRED');
  validateAuthorization(authorization,recovery,id,now);
  if(!authorizationBytes.equals(await readFile(p.authorization))) throw Error('CONTINUATION_AUTHORIZATION_CHANGED');
  return {...recovery,authorization,authorizationDigest:hash(authorizationBytes)};
}
/** Exclusive locks are not evidence or approval. Stale locks require manual inspection. */
export async function withContinuationLocks<T>(directory: string, id: string, action:()=>Promise<T>) {
  const {base,root}=continuationPaths(directory,id);
  await regularDirectory(base);await regularDirectory(root);
  const held: {path:string;handle:Awaited<ReturnType<typeof open>>}[]=[];
  try {
    for (const name of ['operation.lock','controller.lock']) {
      const path=join(base,name);
      const handle=await open(path,'wx',0o600).catch(()=>{throw Error('CONTINUATION_LOCKED_RECONCILIATION_REQUIRED');});
      held.push({path,handle});
    }
    return await action();
  } finally { for (const {path,handle} of held.reverse()) {await handle.close();await rm(path,{force:true});} }
}
export async function publishImmutable(path: string, value: unknown) {
  const temp=path+'.'+randomUUID()+'.tmp';
  try {
    const handle=await open(temp,'wx',0o600);
    try {await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();} finally {await handle.close();}
    await link(temp,path);
    const dir=await open(resolve(path,'..'),'r');try {await dir.sync();}finally{await dir.close();}
  } finally {await rm(temp,{force:true});}
}
/** Only the separate explicit operator command calls this. Never called by resume. */
export async function authorizeContinuation(directory: string,id: string,options: {
  confirmed: boolean; recoveryDigest: string; operator: string; expiresAt: string;
  reuseLocalAnalyticsProbe: boolean; dispatchStages: ContinuationStage[]; capabilityProbeAgents: string[];
}) {
  if (options.confirmed!==true || options.reuseLocalAnalyticsProbe!==true) throw Error('EXPLICIT_CONTINUATION_APPROVAL_REQUIRED');
  return withContinuationLocks(directory,id,async()=>{
    const r=await inspectContinuationRecovery(directory,id),p=continuationPaths(directory,id);
    if (options.recoveryDigest!==r.recoveryDigest) throw Error('CONTINUATION_RECOVERY_DIGEST_MISMATCH');
    const old=await optionalRecord(p.authorization);
    const authorization: ContinuationAuthorization={version:1,kind:'synthetic-continuation-authorization',jobId:id,
      recoveryDigest:r.recoveryDigest,policyDigest:r.recovery.policyDigest,operator:options.operator,
      issuedAt:old?.issuedAt ?? new Date().toISOString(),expiresAt:options.expiresAt,scope:'isolated-synthetic',
      reuseLocalAnalyticsProbe:true,dispatchStages:[...options.dispatchStages],capabilityProbeAgents:[...options.capabilityProbeAgents],
      planOnly:true,implementAuthorized:false,resendAuthorized:false,deliveryAuthenticated:false,authorshipAuthenticated:false};
    validateAuthorization(authorization,r,id,Date.now());
    if(old) {if(dispatchDigest(old)!==dispatchDigest(authorization)) throw Error('CONTINUATION_AUTHORIZATION_CONFLICT');return old as ContinuationAuthorization;}
    const dir=join(p.base,'continuation-authorizations');await mkdir(dir,{recursive:true,mode:0o700});await regularDirectory(dir);
    if((await inspectContinuationRecovery(directory,id)).recoveryDigest!==r.recoveryDigest) throw Error('CONTINUATION_EVIDENCE_CHANGED');
    await publishImmutable(p.authorization,authorization);
    return authorization;
  });
}
