import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateOperationalPolicy } from '../ai/operational-routing.js';
import { readOperationalJson, validateProbe, validateProbeBinding } from './operational-run.js';
import { artifactDigest, readPersistedStageResult, migrationStages, type Stage } from './central-controller.js';
import { dispatchDigest, verifyDispatch } from './dispatch-executor.js';
import { FileCheckpointStore } from './file-checkpoint-store.js';

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
async function optional(file: string) {
  try { return await readOperationalJson(file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
// No lock acquisition or writes: reject symlinks and detect changes during inspection.
export async function snapshotOperational(root: string): Promise<Record<string, string>> {
  if (!(await lstat(root)).isDirectory()) throw Error('INVALID_RECONCILIATION_DIRECTORY');
  const result: Record<string, string> = {};
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isDirectory()) {
      result[name + '/'] = 'directory';
      for (const [key, value] of Object.entries(await snapshotOperational(path))) result[name + '/' + key] = value;
    } else {
      if (!stat.isFile() || stat.size > 5_000_000) throw Error('INVALID_RECONCILIATION_FILE');
      result[name] = `${stat.mtimeMs}:${stat.size}:${hash(await readFile(path))}`;
    }
  }
  return result;
}
interface Evidence {
  kind: 'probe' | 'stage'; key: string; taskId?: string; agentId?: string;
  state: 'local-result-valid' | 'pending' | 'invalid';
  provenance?: 'digest-verified' | 'legacy-route-only';
  outcome?: string; resultDigest?: string; proofPresent?: boolean;
  deliveryAuthenticated: false; authorshipAuthenticated: false;
  pending: string[]; uncertainties: string[];
}
/** Offline audit only. Never invokes a workflow, executor, transport or checkpoint writer. */
export async function reconcileOperational(directory: string, id: string) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw Error('INVALID_OPERATIONAL_ID');
  const root = join(resolve(directory), id), before = await snapshotOperational(root);
  const operation = await readOperationalJson(join(root, 'operation.json'));
  if (operation.version !== 1 || operation.jobId !== id || !['task','pipeline','next'].includes(operation.kind) ||
      (operation.planOnly !== undefined && typeof operation.planOnly !== 'boolean')) throw Error('INVALID_OPERATIONAL_RECORD');
  const policy = validateOperationalPolicy(operation.policy);
  const checkpoint = await new FileCheckpointStore(root).get(id);
  const evidence: Evidence[] = [], pending: string[] = [];
  const probeIds = new Map(policy.agents.map(a => [hash(a.agentId).slice(0,20), a]));
  const probeDirs = [...new Set(Object.keys(before).filter(f => f.startsWith('probes/')).map(f => f.split('/')[1]).filter(Boolean))];
  const stages = [...new Set(Object.keys(before).map(f => f.match(/^([A-Z_]+)\.(?:task|route|dispatch|dispatch-attempt|dispatch-receipt|result)\.json$/)?.[1]).filter((s): s is string => !!s))];
  for (const entry of [...probeDirs.map(key => ({kind:'probe' as const,key})), ...stages.map(key => ({kind:'stage' as const,key}))]) {
    const item: Evidence = {...entry,state:'pending',deliveryAuthenticated:false,authorshipAuthenticated:false,pending:[],uncertainties:[]};
    evidence.push(item);
    const dir = entry.kind === 'probe' ? join(root,'probes',entry.key) : root;
    const stage = entry.kind === 'probe' ? 'CAPABILITY' : entry.key;
    try {
      const task = await readOperationalJson(join(dir,stage+'.task.json'));
      const route = await readOperationalJson(join(dir,stage+'.route.json'));
      item.taskId = task.taskId; item.agentId = task.agentId;
      if (task.stage !== stage) throw Error('TASK_STAGE_MISMATCH');
      if (entry.kind === 'probe') {
        const agent = probeIds.get(entry.key);
        if (!agent) throw Error('PROBE_POLICY_MISMATCH');
        validateProbeBinding(task,route,agent);
      } else {
        if (!migrationStages.includes(stage as Stage)) throw Error('UNKNOWN_STAGE');
        const selected = route.selected ?? route.route;
        if (!selected || (task.agentId && selected.agentId !== task.agentId) ||
            !policy.agents.some(a => a.agentId === selected.agentId) ||
            (task.routeDigest && dispatchDigest(selected) !== task.routeDigest)) throw Error('DISPATCH_ROUTE_MISMATCH');
      }
      await verifyDispatch(dir,stage,task);
      item.provenance = task.requestDigest ? 'digest-verified' : 'legacy-route-only';
      if (!task.requestDigest) item.uncertainties.push('LEGACY_EXECUTOR_EVIDENCE_UNAVAILABLE');
      const receipt = await optional(join(dir,stage+'.dispatch-receipt.json'));
      item.outcome = receipt?.outcome ?? 'not-recorded';
      if (!receipt || receipt.outcome === 'unknown') item.uncertainties.push('TRANSPORT_OUTCOME_UNCONFIRMED');
      if (entry.kind === 'probe') {
        const value = await optional(join(dir,'capability.json'));
        if (!value) { item.pending.push('CAPABILITY_RESULT_MISSING'); continue; }
        const agent = probeIds.get(entry.key)!;
        validateProbe(value,task.taskId,entry.key,task.nonce,agent);
        item.resultDigest = await artifactDigest(dir,'capability.json');
        const proof = await optional(join(dir,'proof.json'));
        item.proofPresent = !!proof;
        if (proof && (proof.artifactDigest !== item.resultDigest || proof.taskId !== task.taskId || proof.agentId !== agent.agentId ||
            JSON.stringify(proof.capabilities) !== JSON.stringify(agent.capabilities))) throw Error('CAPABILITY_EVIDENCE_CHANGED');
        if (!proof) item.pending.push('PROOF_NOT_PERSISTED_DRY_RUN');
      } else {
        const output = await readPersistedStageResult(root,id,stage as Stage,task);
        if (!output) { item.pending.push('STAGE_RESULT_MISSING'); continue; }
        item.resultDigest = output.resultDigest;
        item.uncertainties.push('WORKFLOW_SPECIFIC_ACCEPTANCE_NOT_PERFORMED');
        const name = stage.toLowerCase().replaceAll('_','-');
        const saved = checkpoint?.outputs[name] as any;
        if (saved) {
          if (saved.resultDigest !== output.resultDigest) throw Error('CHECKPOINT_RESULT_CHANGED');
          if (saved.dispatch && (saved.dispatch.taskId !== task.taskId || saved.dispatch.requestDigest !== task.requestDigest ||
              saved.dispatch.routeDigest !== task.routeDigest || saved.dispatch.agentId !== task.agentId)) throw Error('CHECKPOINT_PROVENANCE_MISMATCH');
          for (const artifact of saved.artifacts ?? []) if (await artifactDigest(root,artifact.file) !== artifact.digest) throw Error('CHECKPOINT_ARTIFACT_CHANGED');
        }
      }
      item.state = 'local-result-valid';
    } catch (e) {
      item.state = 'invalid';
      item.pending.push((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'PERSISTED_EVIDENCE_INCOMPLETE' : e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'INVALID_PERSISTED_EVIDENCE');
    }
  }
  for (const name of checkpoint?.completed ?? []) if (name !== 'review' && !evidence.some(e => e.kind === 'stage' && e.key === name.replaceAll('-','_').toUpperCase())) pending.push('CHECKPOINT_STAGE_NOT_INSPECTED:'+name);
  if (!checkpoint) pending.push('CHECKPOINT_MISSING');
  if (!evidence.length) pending.push('NO_PERSISTED_TASKS');
  const persistedStatus = await optional(join(root,'operation-status.json'));
  const stable = JSON.stringify(before) === JSON.stringify(await snapshotOperational(root));
  if (!stable) pending.push('RECORDS_CHANGED_DURING_INSPECTION');
  return {
    version:1, jobId:id, mode:'dry-run', readOnly:true,
    state: !stable || evidence.some(e => e.state === 'invalid') ? 'invalid' : pending.length || evidence.some(e => e.state === 'pending') ? 'pending' : 'local-evidence-valid',
    planOnly:operation.planOnly ?? false, persistedStatus,
    checkpoint:checkpoint ? {state:checkpoint.state,completed:checkpoint.completed} : null,
    evidence,pending,uncertainties:['LOCAL_FILES_DO_NOT_AUTHENTICATE_DELIVERY_OR_AUTHOR','SNAPSHOT_IS_NOT_A_LOCK_OR_AUTHORIZATION'],
    recordsStable:stable, deliveryAuthenticated:false, authorshipAuthenticated:false,
    resendAuthorized:false, pipelineAdvanceAuthorized:false,
  };
}
