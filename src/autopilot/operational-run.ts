import { requireMaestriSessionBoundDispatch } from '../integrations/maestri-wire-contract.js';
import type { SessionAttestationProvider } from '../sessions/session-attestation.js';
import { operationalSessionGate } from '../integrations/operational-session-attestation.js';
import { maestriSessionAttestationProvider } from '../integrations/maestri-session-attestation.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { runCentralWorkflow, artifactDigest, demo, type Stage, type CentralWorkflow } from './central-controller.js';
import { dispatchDigest, persistDispatchRequest, executePendingDispatch, cliDispatchExecutor, verifyDispatch } from './dispatch-executor.js';
import { maestriTransport, type MaestriTransport } from '../integrations/maestri-central-cli.js';
import { prepareIsolatedNextPilot, isolatedNextWorkflow } from './isolated-next-pilot.js';
import { parseConnectedAgentNames } from '../integrations/maestri-model-router.js';
import { selectOperationalRoute, validateOperationalPolicy, type AgentDeclaration, type OperationalPolicy, type OperationalProof } from '../ai/operational-routing.js';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const roles: Partial<Record<Stage, string>> = { ANALYZE: 'analysis', MAP_COMPONENTS: 'mapping', PLAN: 'planning', IMPLEMENT: 'coding', VALIDATE: 'validation' };
const challenge = { components: [{ id: 'hero', resourceType: 'demo/components/hero' }, { id: 'text', resourceType: 'demo/components/text' }], broken: { id: 'broken', resourceType: '' } };
export async function readOperationalJson(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 256000) throw Error('INVALID_OPERATIONAL_RECORD');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function atomic(file: string, value: unknown) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
/** Bounded synthetic exercise validates execution of the declared interface, not general competence. */
export function validateProbe(value: any, taskId: string, jobId: string, nonce: string, agent: AgentDeclaration) {
  if (!value || value.version !== 1 || value.taskId !== taskId || value.jobId !== jobId || value.nonce !== nonce) throw Error('INVALID_CAPABILITY_RESULT');
  const checks: Record<string, boolean> = {
    analysis: value.analysis?.componentCount === 2,
    mapping: value.mapping?.hero === 'demo/components/hero' && value.mapping?.text === 'demo/components/text',
    planning: JSON.stringify(value.planning) === JSON.stringify(['analyze','map','implement','validate']),
    coding: typeof value.coding === 'string' && /^export const componentCount\s*=\s*2;?$/.test(value.coding.trim()),
    validation: JSON.stringify(value.validation) === JSON.stringify(['broken']),
  };
  if (agent.capabilities.some(c => checks[c] !== true)) throw Error('CAPABILITY_VALIDATION_FAILED');
}
export function validateProbeBinding(task: any, route: any, agent: AgentDeclaration) {
  if (task.agentId !== agent.agentId || route.selected?.policyDigest !== dispatchDigest(agent) || !task.requestDigest ||
    task.routeDigest !== dispatchDigest(route.selected) || !/^[a-f0-9]{32}$/.test(task.nonce) ||
    !Number.isInteger(task.polls) || task.polls < 0 || task.polls > 12) throw Error('PROBE_RECONCILIATION_REQUIRED');
}
export async function capabilityProbe(root: string, agent: AgentDeclaration, transport: MaestriTransport, pollMs: number, stopOnAmbiguousDispatch = false, authorize?: () => Promise<void>): Promise<OperationalProof> {
  const id = digest(agent.agentId).slice(0,20), dir = join(root, 'probes', id);
  const protectedRoot = await lstat(join(root,'analytics-probe-recovery.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  if(protectedRoot) throw Error('RECOVERED_PROBE_REQUIRES_CONTINUATION_GATE');
  if(basename(dirname(root))==='continuations' && !authorize) throw Error('CONTINUATION_GATE_REQUIRED');
  await authorize?.();
  const save = async (file:string,value:unknown) => {await authorize?.();await atomic(file,value);};
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let task: { taskId: string; stage: string; agentId: string; routeDigest: string; nonce: string; polls: number; requestDigest?: string };
  try { task = await readOperationalJson(join(dir,'CAPABILITY.task.json')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // A partial intent must be reconciled, never silently replaced.
    for (const suffix of ['route','dispatch','dispatch-attempt']) {
      try { await lstat(join(dir,`CAPABILITY.${suffix}.json`)); throw Error('PROBE_RECONCILIATION_REQUIRED'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const selected = { agentId: agent.agentId, mode: 'capability-probe', policyDigest: dispatchDigest(agent) };
    task = { taskId: randomUUID(), stage: 'CAPABILITY', agentId: agent.agentId, routeDigest: dispatchDigest(selected), nonce: randomBytes(16).toString('hex'), polls: 0 };
    await save(join(dir,'CAPABILITY.route.json'), { selected });
    await save(join(dir,'CAPABILITY.task.json'), task);
    const prompt = [
      `Migration Maestro isolated capability task ${task.taskId}. Work ONLY in ${dir}.`,
      'Do not read other projects/history, call network, AEM, git, or change sessions. Do not send messages to other agents.',
      `Input: ${JSON.stringify(challenge)}. Capabilities to exercise: ${agent.capabilities.join(', ')}.`,
      `Write only capability.json atomically: {version:1,jobId:${JSON.stringify(id)},taskId:${JSON.stringify(task.taskId)},nonce:${JSON.stringify(task.nonce)},analysis:{componentCount:<count valid components>},mapping:{<component id>:<its resourceType>},planning:[<order analyze/map/implement/validate by dependency>],coding:<TypeScript export const componentCount with the counted numeric literal>,validation:[<IDs missing resourceType>]}.`,
      'Fill all five answers from the input, not a self-assessment. The coordinator checks them. No controller records may be edited. Reply briefly; ACK is not completion.',
    ].join('\n');
    task.requestDigest = await persistDispatchRequest(dir, { version: 1, jobId: id, taskId: task.taskId, stage: 'CAPABILITY', agentId: agent.agentId, routeDigest: task.routeDigest, prompt });
    await save(join(dir,'CAPABILITY.task.json'), task);
    await authorize?.();
    const executor = cliDispatchExecutor(transport);
    if (authorize) executor.authorize = authorize;
    const dispatch = await executePendingDispatch(dir,'CAPABILITY',executor);
    if (dispatch.outcome === 'unknown' && stopOnAmbiguousDispatch) throw Error('AMBIGUOUS_DISPATCH_RECONCILIATION_REQUIRED');
  }
  const route = await readOperationalJson(join(dir,'CAPABILITY.route.json'));
  validateProbeBinding(task, route, agent);
  await verifyDispatch(dir,'CAPABILITY',task);
  for (;;) {
    try {
      const value = await readOperationalJson(join(dir,'capability.json'));
      validateProbe(value,task.taskId,id,task.nonce,agent);
      const artifact = await artifactDigest(dir,'capability.json');
      let proof: OperationalProof;
      try {
        proof = await readOperationalJson(join(dir,'proof.json'));
        if (proof.artifactDigest !== artifact || proof.taskId !== task.taskId || proof.agentId !== agent.agentId ||
          JSON.stringify(proof.capabilities) !== JSON.stringify(agent.capabilities)) throw Error('CAPABILITY_EVIDENCE_CHANGED');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        proof = { agentId: agent.agentId, capabilities: [...agent.capabilities], checkedAt: new Date().toISOString(), artifactDigest: artifact, taskId: task.taskId };
        await save(join(dir,'proof.json'),proof);
      }
      return proof;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (task.polls >= 12) throw Error('CAPABILITY_PENDING_NO_RESEND');
    task.polls++;
    await save(join(dir,'CAPABILITY.task.json'),task);
    await transport('check',[agent.agentId]);
    if (pollMs) await new Promise(r => setTimeout(r,pollMs));
  }
}
const minimalWorkflow: CentralWorkflow = {
  input: { version: 1, kind: 'isolated-inventory-v1', fixture: challenge }, stages: ['ANALYZE','REVIEW'],
  async prepare() {},
  instructions() { return `Work only in the assigned job directory. No corporate files, AEM, network, git, dependencies or session changes. Input ${JSON.stringify(challenge)}. Write inventory.json with {version:1,componentCount:<valid count>,resourceTypes:[<valid resourceTypes in input order>],missingResourceTypeIds:[<invalid IDs>]}. Include inventory.json in result.artifacts. Write no other files except the assigned evidence/result.`; },
  async validate(_stage, root) {
    const v = await readOperationalJson(join(root,'inventory.json'));
    if (v.version !== 1 || v.componentCount !== 2 || JSON.stringify(v.resourceTypes) !== JSON.stringify(challenge.components.map(c => c.resourceType)) || JSON.stringify(v.missingResourceTypeIds) !== '["broken"]') throw Error('INVENTORY_CONTRACT_FAILED');
    return { artifacts: [{ file:'inventory.json', digest: await artifactDigest(root,'inventory.json') }] };
  },
};
export async function runOperational(options: {
  directory: string; id: string; kind: 'task' | 'pipeline' | 'next'; policy: OperationalPolicy;
  confirmed: boolean; transport?: MaestriTransport; pollMs?: number; pauseAfter?: 'ANALYZE' | 'MAP_COMPONENTS' | 'PLAN';
  executionMode?: 'real' | 'simulated';
  /** Trusted provider adapter; never loaded from user JSON or terminal output. */
  sessionAttestationProvider?: SessionAttestationProvider;
  /** Immutable authorization ceiling for a new planning-only pilot. */
  planOnly?: boolean;
}) {
  if (!/^[a-f0-9]{20}$/.test(options.id) || !['task','pipeline','next'].includes(options.kind)) throw Error('INVALID_OPERATIONAL_RUN');
  const pollMs = options.pollMs ?? 3000;
  if (!Number.isInteger(pollMs) || pollMs < 0 || pollMs > 5000) throw Error('INVALID_RETRY_POLICY');
  if (!options.confirmed) throw Error('SYNTHETIC_DISPATCH_CONFIRMATION_REQUIRED');
  if (options.planOnly && options.kind !== 'pipeline') throw Error('PLAN_ONLY_REQUIRES_PIPELINE');
  const policy = validateOperationalPolicy(options.policy), base = resolve(options.directory), root = join(base,options.id);
  const prior = await readOperationalJson(join(root,'operation.json')).catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
  const recovered = await lstat(join(root,'analytics-probe-recovery.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  if (prior?.planOnly || recovered) {
    const { continueOperational } = await import('./operational-continuation.js');
    if (!options.planOnly || options.kind!=='pipeline' || dispatchDigest(prior?.policy)!==dispatchDigest(policy)) throw Error('OPERATION_INPUT_CHANGED');
    return continueOperational({...options, directory:base});
  }
  await mkdir(root,{ recursive:true, mode:0o700 });
  if (!(await lstat(base)).isDirectory() || !(await lstat(root)).isDirectory()) throw Error('OPERATION_DIRECTORY_NOT_ISOLATED');
  const lockPath = join(base,'operation.lock'), lock = await open(lockPath,'wx').catch(() => { throw Error('OPERATION_LOCKED_RECONCILIATION_REQUIRED'); });
  const transport = options.transport ?? maestriTransport(undefined,10000);
  const verifyPlan=operationalSessionGate(options.sessionAttestationProvider ?? maestriSessionAttestationProvider(transport),root);
  // Injected transports are simulation unless an application explicitly supplies a real authorized transport.
  const executionMode = options.executionMode ?? (options.transport ? 'simulated' : 'real');
  try {
    const input = { version:1, jobId:options.id, kind:options.kind, policy, executionMode, scope:'isolated-synthetic', confirmed:true, ...(options.planOnly ? {planOnly:true} : {}) };
    try { await writeFile(join(root,'operation.json'),JSON.stringify(input,null,2),{ flag:'wx',mode:0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (dispatchDigest(await readOperationalJson(join(root,'operation.json'))) !== dispatchDigest(input)) throw Error('OPERATION_INPUT_CHANGED'); }
    await atomic(join(root,'operation-status.json'),{ status:'running', executionMode, realAcceptanceVerified:false });
    // Revalidate already accepted probe bytes even when all pipeline stages are cached.
    for (const agent of policy.agents) {
      const probeDir = join(root,'probes',digest(agent.agentId).slice(0,20));
      let proof;
      try { proof = await readOperationalJson(join(probeDir,'proof.json')); }
      catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
      if (await artifactDigest(probeDir,'capability.json') !== proof.artifactDigest) throw Error('CAPABILITY_EVIDENCE_CHANGED');
      await capabilityProbe(root,agent,transport,0,options.planOnly);
    }
    const next = options.kind === 'next' ? await prepareIsolatedNextPilot(base,options.id) : null;
    const executor=cliDispatchExecutor(transport);
    executor.authorize=async request=>{
      if(request.stage==='PLAN') {
        const agent=policy.agents.find(a=>a.agentId===request.agentId);
        if(!agent) throw Error('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED');
        const {centralStageRoutes}=await import('../integrations/maestri-model-router.js');
        await verifyPlan(agent,centralStageRoutes.PLAN.request);
        requireMaestriSessionBoundDispatch();
      }
    };
    const checkpoint = await runCentralWorkflow({executor, directory:base,id:options.id,transport,pollMs,maxPolls:12,
      ...(options.kind === 'task' ? { workflow:minimalWorkflow } : next ? { workflow:isolatedNextWorkflow(next.root,next.project,options.id,{exerciseRepair:false}) } : { syntheticMappingContract:true }),
      authorize: async stage => {
        if (stage==='PLAN') {
          const agent=policy.agents.find(a=>a.capabilities.includes('planning'));
          if(!agent) throw Error('DECLARED_CAPABLE_AGENT_REQUIRED');
          const { centralStageRoutes } = await import('../integrations/maestri-model-router.js');
          await verifyPlan(agent,centralStageRoutes.PLAN.request);
          requireMaestriSessionBoundDispatch();
        }
      },
      routingContext: input, pauseAfter:options.planOnly ? 'PLAN' : options.pauseAfter, stopOnAmbiguousDispatch:options.planOnly,
      async resolveRoute(stage, request) {
        const capability = roles[stage];
        const agent = policy.agents.find(a => a.capabilities.includes(capability!) && !request.excludedAgentIds?.includes(a.agentId));
        if (!agent) throw Error('DECLARED_CAPABLE_AGENT_REQUIRED');
        const listing = await transport('list',[]);
        const names = parseConnectedAgentNames(listing);
        if (!names.includes(agent.agentId)) throw Error('DECLARED_AGENT_NOT_CONNECTED');
        const section = listing.split(/Connected agents:\s*/i)[1]?.split(/Connected portals\b/i)[0] ?? listing;
        if ([...section.matchAll(/name:\s*"([^"]{1,100})"/g)].filter(m=>m[1]===agent.agentId).length !== 1) throw Error('AMBIGUOUS_AGENT_NAME');
        await transport('check',[agent.agentId]);
        if (stage==='PLAN') return await verifyPlan(agent,request);
        const proof = await capabilityProbe(root,agent,transport,pollMs,options.planOnly);
        // This entry point only creates the fixed tiny synthetic fixture, never caller-supplied migration work.
        return selectOperationalRoute({ policy, agentId:agent.agentId, proof, connected:true, confirmed:true, now:Date.now(),
          request:{ ...request, signals:{ taskKind:'read', affectedFiles:next ? 3 : 1, technicalRisk:'low', reasoningNeed:next ? 'medium' : 'low', confidence:1 } } });
      },
    });
    const status = checkpoint.state === 'awaiting-review' ? 'awaiting-approval' : 'pending';
    const report = { version:1,jobId:options.id,status,executionMode,completed:checkpoint.completed,
      realAcceptanceVerified:executionMode === 'real' && checkpoint.state === 'awaiting-review',
      identityVerified:false,availabilityVerified:false,availability:'unknown',humanReviewRequired:true,
      publicationAuthorized:false, aemWritesPerformed:false };
    let reviewed;
    try { reviewed = await readOperationalJson(join(root,'review.json')); } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (reviewed) {
      if (reviewed.checkpointDigest !== await artifactDigest(root,options.id+'.checkpoint.json')) throw Error('REVIEW_CHECKPOINT_CHANGED');
      const accepted = { ...report,status:'completed',humanReviewRequired:false,review:reviewed };
      await atomic(join(root,'operation-status.json'),accepted);
      return accepted;
    }
    await atomic(join(root,'operation-status.json'),report);
    return report;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const code = cause instanceof Error && /^[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'OPERATION_STAGE_FAILED';
    const status = /PENDING|POLL_BUDGET/.test(code) ? 'pending' : /INVALID|MISMATCH|CHANGED|CONTRACT_FAILED|VALIDATION_FAILED/.test(code) ? 'failed' : 'blocked';
    const report = { version:1,jobId:options.id,status,reason:code,executionMode,realAcceptanceVerified:false,
      recovery:'Resume the same ID; never delete receipts or resend ambiguous work.' };
    await atomic(join(root,'operation-status.json'),report);
    return report;
  } finally { await lock.close(); await rm(lockPath,{ force:true }); }
}

/** Operator-owned local acceptance only; never authorizes merge, publishing or AEM writes. */
export async function reviewOperational(directory: string, id: string, reviewer: string) {
  if (!/^[a-f0-9]{20}$/.test(id) || !/^[A-Za-z0-9][A-Za-z0-9_.@ -]{0,99}$/.test(reviewer)) throw Error('INVALID_REVIEW');
  const base=resolve(directory),root=join(base,id);
  const recovered=await lstat(join(root,'analytics-probe-recovery.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  if(recovered) throw Error('RECOVERED_JOB_REQUIRES_CONTINUATION_GATE');
  const lockPath=join(base,'operation.lock'),lock=await open(lockPath,'wx').catch(()=>{throw Error('OPERATION_LOCKED_RECONCILIATION_REQUIRED');});
  try {
    const { FileCheckpointStore } = await import('./file-checkpoint-store.js');
    const cp = await new FileCheckpointStore(root).get(id);
    const operation = await readOperationalJson(join(root,'operation.json'));
    if (!cp || cp.state !== 'awaiting-review' || cp.completed.at(-1) !== 'review') throw Error('REVIEW_NOT_READY');
    for (const name of cp.completed.filter(n=>n!=='review')) {
      const stage=name.replaceAll('-','_').toUpperCase(),out=cp.outputs[name] as any;
      const task=await readOperationalJson(join(root,stage+'.task.json'));
      const route=await readOperationalJson(join(root,stage+'.route.json'));
      if (!out.dispatch || dispatchDigest(route.selected) !== task.routeDigest ||
          out.dispatch.taskId !== task.taskId || out.dispatch.requestDigest !== task.requestDigest || out.dispatch.routeDigest !== task.routeDigest) throw Error('REVIEW_PROVENANCE_CHANGED');
      await verifyDispatch(root,stage,task);
      if (await artifactDigest(root,stage+'.result.json') !== out.resultDigest) throw Error('REVIEW_RESULT_CHANGED');
      for(const artifact of out.artifacts??[]) if(await artifactDigest(root,artifact.file)!==artifact.digest) throw Error('REVIEW_ARTIFACT_CHANGED');
      if(out.htmlDigest && await artifactDigest(root,'index.html')!==out.htmlDigest) throw Error('REVIEW_IMPLEMENTATION_CHANGED');
    }
    const checkpointDigest=await artifactDigest(root,id+'.checkpoint.json');
    const receipt={version:1,jobId:id,reviewer,checkpointDigest,executionMode:operation.executionMode,acceptedLocally:true,publicationAuthorized:false};
    try { await writeFile(join(root,'review.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600}); }
    catch(e) {if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(dispatchDigest(await readOperationalJson(join(root,'review.json')))!==dispatchDigest(receipt))throw Error('REVIEW_ALREADY_RECORDED_DIFFERENTLY');}
    const status={...(await readOperationalJson(join(root,'operation-status.json'))),status:'completed',humanReviewRequired:false,review:receipt};
    await atomic(join(root,'operation-status.json'),status);
    return status;
  } finally {await lock.close();await rm(lockPath,{force:true});}
}
