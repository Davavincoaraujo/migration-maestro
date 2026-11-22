import { diagnoseMaestri } from './integrations/maestri-diagnostic.js';
import { requestSessionAttestation } from './sessions/session-attestation.js';
import { maestriSessionAttestationProvider } from './integrations/maestri-session-attestation.js';
import { inspectContinuationRecovery, inspectContinuationAuthorization, authorizeContinuation, type ContinuationStage } from './autopilot/continuation-authorization.js';
import { continueOperational } from './autopilot/operational-continuation.js';
import { recoverOperationalProbe } from './autopilot/operational-recover.js';
import { reconcileOperational } from './autopilot/operational-reconcile.js';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runOperational, readOperationalJson, reviewOperational } from './autopilot/operational-run.js';
import { validateOperationalPolicy } from './ai/operational-routing.js';
const directory = '.local-maestro/operations';
try {
  const [command, idArg, ...flags] = process.argv.slice(2);
  if (command === 'diagnose-maestri') {
    const args=[idArg,...flags].filter((v):v is string=>v!==undefined);
    const ids=args.filter(v=>!v.startsWith('--'));
    if(ids.length>1 || (ids[0] && !/^[a-f0-9]{20}$/.test(ids[0])) ||
      args.some(v=>v.startsWith('--') && v!=='--observe-model') || new Set(args).size!==args.length) throw Error('INVALID_MAESTRI_DIAGNOSTIC_ARGUMENTS');
    const source=ids[0]? (await readOperationalJson(join(directory,ids[0],'operation.json'))).policy : await readOperationalJson('config/operational-agents.json');
    const report=await diagnoseMaestri({policy:validateOperationalPolicy(source),observeModel:args.includes('--observe-model')});
    console.log(JSON.stringify(report,null,2));
    if(report.ipc.state!=='reachable' || report.samples.some(s=>!s.listingValid)) process.exitCode=1;
  } else if (command === 'inspect-session-attestations') {
    if(!idArg || !/^[a-f0-9]{20}$/.test(idArg) || flags.length) throw Error('INVALID_SESSION_INSPECTION_ARGUMENTS');
    const operation=await readOperationalJson(join(directory,idArg,'operation.json'));
    const policy=validateOperationalPolicy(operation.policy), provider=maestriSessionAttestationProvider();
    const results=[];
    for(const agent of policy.agents) {
      const expectedProfile=agent.capabilities.includes('planning')?'ADVANCED':agent.capabilities.includes('mapping')?'BALANCED':'ECONOMY';
      const result=agent.provider==='unknown' || !agent.modelId ? {status:'unverified',reason:'DECLARED_MODEL_REQUIRED_FOR_COMPATIBILITY_CHECK'} :
        await requestSessionAttestation(provider,{agentId:agent.agentId,provider:agent.provider,modelId:agent.modelId,profile:expectedProfile,capability:agent.capabilities.includes('planning')?'planning':agent.capabilities[0]});
      results.push({agentId:agent.agentId,requiredProfile:expectedProfile,result});
    }
    console.log(JSON.stringify({readOnly:true,jobId:idArg,authorizationGranted:false,results},null,2));
  } else if (command === 'inspect-continuation') {
    if (!idArg || flags.length) throw Error('INVALID_CONTINUATION_INSPECTION_ARGUMENTS');
    const r = await inspectContinuationRecovery(directory,idArg);
    let authorization;
    try { authorization = (await inspectContinuationAuthorization(directory,idArg)).authorization; }
    catch(e) { authorization = {valid:false,reason:e instanceof Error ? e.message : 'INVALID_CONTINUATION_AUTHORIZATION'}; }
    console.log(JSON.stringify({jobId:idArg,readOnly:true,recoveryDigest:r.recoveryDigest,policyDigest:r.recovery.policyDigest,
      originalDispatch:r.recovery.originalDispatch,deliveryAuthenticated:false,authorshipAuthenticated:false,authorization},null,2));
  } else if (command === 'authorize-continuation') {
    const value=(key:string)=>flags.find(f=>f.startsWith(key+'='))?.slice(key.length+1);
    const allowed=['--operator','--recovery-digest','--expires-at','--dispatch-stages','--capability-probes'];
    if(!idArg || !flags.includes('--approve-continuation') || !flags.includes('--reuse-local-probe') ||
      flags.some(f=>!['--approve-continuation','--reuse-local-probe'].includes(f) && !allowed.some(k=>f.startsWith(k+'='))) ||
      new Set(flags.map(f=>f.split('=')[0])).size!==flags.length || allowed.some(k=>value(k)===undefined)) throw Error('EXPLICIT_CONTINUATION_APPROVAL_REQUIRED');
    const list=(s:string)=>s==='none'?[]:s.split(',');
    console.log(JSON.stringify(await authorizeContinuation(directory,idArg,{confirmed:true,reuseLocalAnalyticsProbe:true,
      operator:value('--operator')!,recoveryDigest:value('--recovery-digest')!,expiresAt:value('--expires-at')!,
      dispatchStages:list(value('--dispatch-stages')!) as ContinuationStage[],capabilityProbeAgents:list(value('--capability-probes')!)}),null,2));
  } else if (command === 'resume') {
    if(!idArg || flags.length!==1 || flags[0]!=='--confirm-synthetic') throw Error('INVALID_CONTINUATION_RESUME_ARGUMENTS');
    console.log(JSON.stringify(await continueOperational({directory,id:idArg,confirmed:true}),null,2));
  } else if (command === 'recover') {
    if (!idArg || flags.length !== 2 || !flags.includes('--probe-only') || !flags.includes('--confirm-synthetic')) throw Error('EXPLICIT_PROBE_RECOVERY_CONFIRMATION_REQUIRED');
    console.log(JSON.stringify(await recoverOperationalProbe(directory, idArg, { probeOnly: true, confirmed: true }), null, 2));
  } else if (command === 'reconcile') {
    if (!idArg || flags.length !== 1 || flags[0] !== '--dry-run') throw Error('RECONCILE_REQUIRES_DRY_RUN');
    const report = await reconcileOperational(directory,idArg);
    console.log(JSON.stringify(report,null,2));
    if (report.state === 'invalid') process.exitCode = 1;
  } else if (command === 'review') {
    if (!idArg || flags.length !== 2 || !flags.includes('--approve-local') || !flags.some(f => f.startsWith('--reviewer='))) throw Error('EXPLICIT_LOCAL_REVIEW_REQUIRED');
    console.log(JSON.stringify(await reviewOperational(directory,idArg,flags.find(f=>f.startsWith('--reviewer='))!.slice(11)),null,2));
  } else if (command === 'status') {
    if (flags.length || (idArg && !/^[a-f0-9]{20}$/.test(idArg))) throw Error('INVALID_STATUS_ARGUMENTS');
    const ids = idArg ? [idArg] : await readdir(directory).then(v => v.filter(s => /^[a-f0-9]{20}$/.test(s))).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    console.log(JSON.stringify(await Promise.all(ids.map(id => readOperationalJson(join(directory,id,'operation-status.json')))),null,2));
  } else {
    if (!['task','pipeline','next'].includes(command) || !idArg || flags.some(f => !['--confirm-synthetic','--pause-after-plan','--plan-only'].includes(f)) ||
      new Set(flags).size !== flags.length || !flags.includes('--confirm-synthetic')) throw Error('Usage: npm run maestro:operate -- task|pipeline|next new --confirm-synthetic [--pause-after-plan] [--plan-only]; resume <id> --confirm-synthetic; status [id]');
    const id = idArg === 'new' ? randomBytes(10).toString('hex') : idArg;
    if (!/^[a-f0-9]{20}$/.test(id)) throw Error('INVALID_OPERATIONAL_ID');
    const policy = validateOperationalPolicy(await readOperationalJson('config/operational-agents.json'));
    const kind = command as 'task' | 'pipeline' | 'next';
    if (kind === 'task' && flags.includes('--pause-after-plan')) throw Error('INVALID_PAUSE_STAGE');
    const result = await runOperational({ directory,id,kind,policy,confirmed:true,
      ...((flags.includes('--plan-only')) ? {planOnly:true} : {}),
      ...(flags.includes('--pause-after-plan') ? { pauseAfter:'PLAN' as const } : {}) });
    console.log(JSON.stringify(result,null,2));
    if (result.status === 'blocked') process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error && (/^[A-Z0-9_]+$/.test(e.message) || e.message.startsWith('Usage:')) ? e.message : 'OPERATION_FAILED');
  process.exitCode = 1;
}
