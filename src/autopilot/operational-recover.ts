import { randomUUID } from 'node:crypto';
import { link, lstat, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dispatchDigest } from './dispatch-executor.js';
import { readOperationalJson } from './operational-run.js';
import { reconcileOperational, snapshotOperational } from './operational-reconcile.js';

/** Local audit receipt only. Deliberately never consumed as OperationalProof. */
export async function recoverOperationalProbe(directory: string, id: string, options: { probeOnly: boolean; confirmed: boolean }) {
  if (!options.probeOnly || !options.confirmed) throw Error('EXPLICIT_PROBE_RECOVERY_CONFIRMATION_REQUIRED');
  if (!/^[a-f0-9]{20}$/.test(id)) throw Error('INVALID_OPERATIONAL_ID');
  const base = resolve(directory), root = join(base, id);
  if (!(await lstat(base)).isDirectory() || !(await lstat(root)).isDirectory()) throw Error('INVALID_RECONCILIATION_DIRECTORY');
  const lockPath = join(base, 'operation.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw Error('OPERATION_LOCKED_RECONCILIATION_REQUIRED'); });
  const destination = join(root, 'analytics-probe-recovery.json');
  const temp = join(base, `.probe-recovery-${randomUUID()}.tmp`);
  const snapshot = async () => {
    const files = await snapshotOperational(root);
    delete files['analytics-probe-recovery.json'];
    return files;
  };
  let controllerLock: Awaited<ReturnType<typeof open>> | undefined;
  const controllerLockPath = join(base, 'controller.lock');
  try {
    controllerLock = await open(controllerLockPath, 'wx', 0o600).catch(() => { throw Error('CONTROLLER_LOCKED_REQUIRES_OPERATOR_RECONCILIATION'); });
    const before = await snapshot();
    const report = await reconcileOperational(base, id);
    const operation = await readOperationalJson(join(root, 'operation.json'));
    if (operation.planOnly !== true || operation.kind !== 'pipeline') throw Error('PROBE_RECOVERY_REQUIRES_PLAN_ONLY');
    const probes = report.evidence.filter(e => e.kind === 'probe' && e.agentId === 'Analytics');
    if (!report.recordsStable || report.state === 'invalid' || report.pending.length || probes.length !== 1 ||
        probes[0].state !== 'local-result-valid' || probes[0].provenance !== 'digest-verified' ||
        !report.checkpoint || report.checkpoint.completed.length ||
        report.checkpoint.state !== 'failed') throw Error('PROBE_RECOVERY_EVIDENCE_REQUIRED');
    const probe = probes[0], prefix = `probes/${probe.key}/`;
    const task = await readOperationalJson(join(root, prefix, 'CAPABILITY.task.json'));
    const receipt = await readOperationalJson(join(root, prefix, 'CAPABILITY.dispatch-receipt.json'));
    const record = {
      version: 1, kind: 'local-reconciled-probe', jobId: id, agentId: 'Analytics', probeId: probe.key,
      taskId: task.taskId, nonce: task.nonce, planOnly: true, confirmedSynthetic: true,
      policy: operation.policy, policyDigest: dispatchDigest(operation.policy),
      requestDigest: task.requestDigest, routeDigest: task.routeDigest, resultDigest: probe.resultDigest,
      // Raw-byte hashes preserve every original record, including status and checkpoint.
      files: Object.fromEntries(Object.entries(before).filter(([,v]) => v !== 'directory').map(([k,v]) => [k,v.split(':').at(-1)])),
      originalDispatch: { outcome: receipt.outcome, deliveryVerified: receipt.deliveryVerified },
      deliveryAuthenticated: false, authorshipAuthenticated: false, analyzeCompleted: false,
      resendAuthorized: false, pipelineAdvanceAuthorized: false, humanAuthorizationRequired: true,
    };
    if (JSON.stringify(before) !== JSON.stringify(await snapshot())) throw Error('RECOVERY_EVIDENCE_CHANGED');
    try {
      const existing = await readOperationalJson(destination);
      if (dispatchDigest(existing) !== dispatchDigest(record)) throw Error('RECOVERY_RECORD_CONFLICT');
      return existing;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    // Recheck all source bytes immediately before publishing a complete, immutable receipt.
    if (JSON.stringify(before) !== JSON.stringify(await snapshot())) throw Error('RECOVERY_EVIDENCE_CHANGED');
    await link(temp, destination); // Atomic no-clobber publication, never rename over a receipt.
    const dir = await open(root, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
    return record;
  } finally {
    await rm(temp, { force: true });
    if (controllerLock) { await controllerLock.close(); await rm(controllerLockPath, { force: true }); }
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
