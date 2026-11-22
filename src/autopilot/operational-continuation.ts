import type { SessionAttestationProvider } from '../sessions/session-attestation.js';
import { requireMaestriSessionBoundDispatch } from '../integrations/maestri-wire-contract.js';
import { operationalSessionGate } from '../integrations/operational-session-attestation.js';
import { maestriSessionAttestationProvider } from '../integrations/maestri-session-attestation.js';
import { mkdir, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { continuationPaths, continuationStages, inspectContinuationAuthorization, optionalRecord, publishImmutable, regularDirectory, withContinuationLocks } from './continuation-authorization.js';
import { capabilityProbe } from './operational-run.js';
import { dispatchDigest, cliDispatchExecutor } from './dispatch-executor.js';
import { runCentralWorkflow, type Stage } from './central-controller.js';
import { selectOperationalRoute } from '../ai/operational-routing.js';
import { maestriTransport, type MaestriTransport } from '../integrations/maestri-central-cli.js';
import { centralStageRoutes, parseConnectedAgentNames } from '../integrations/maestri-model-router.js';

/** A continuation has its own execution directory. No historical record is copied or rewritten. */
export async function continueOperational(options: {
  directory:string; id:string; confirmed:boolean; transport?:MaestriTransport; pollMs?:number;
  sessionAttestationProvider?:SessionAttestationProvider;
}) {
  if(options.confirmed!==true) throw Error('SYNTHETIC_DISPATCH_CONFIRMATION_REQUIRED');
  const p=continuationPaths(options.directory,options.id);
  // Reject absent/invalid approval before locks, directories, status, proofs or transport.
  await inspectContinuationAuthorization(p.base,options.id);
  return withContinuationLocks(p.base,options.id,async()=>{
    const initial=await inspectContinuationAuthorization(p.base,options.id);
    const policy=initial.operation.policy;
    const transport=options.transport ?? maestriTransport(undefined,10000);
    const verifyPlan=operationalSessionGate(options.sessionAttestationProvider ?? maestriSessionAttestationProvider(transport),p.executionRoot);
    const agentFor=(stage:Stage)=>policy.agents.find((a:any)=>a.agentId===({ANALYZE:'Analytics',MAP_COMPONENTS:'UE-Pattern',PLAN:'Hermes'} as Partial<Record<Stage,string>>)[stage]);
    const auditDirectory=join(p.executionRoot,'continuation-events');
    const auditHead=async()=>{
      let names:string[];try {names=(await readdir(auditDirectory)).sort();await regularDirectory(auditDirectory);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {count:0,digest:null as string|null};throw e;}
      let digest:string|null=null;
      for(const [index,name] of names.entries()) {
        if(name!==String(index+1).padStart(6,'0')+'.json') throw Error('CONTINUATION_AUDIT_INVALID');
        const event=await optionalRecord(join(auditDirectory,name));
        if(!event || event.version!==1 || event.jobId!==options.id || event.authorizationDigest!==initial.authorizationDigest || event.previousDigest!==digest || event.sequence!==index+1 || event.deliveryAuthenticated!==false || event.authorshipAuthenticated!==false) throw Error('CONTINUATION_AUDIT_INVALID');
        digest=dispatchDigest(event);
      }
      return {count:names.length,digest};
    };
    const gate=async(stage?:Stage)=>{
      const current=await inspectContinuationAuthorization(p.base,options.id);
      if(current.authorizationDigest!==initial.authorizationDigest) throw Error('CONTINUATION_AUTHORIZATION_CHANGED');
      if(stage && !(continuationStages as readonly string[]).includes(stage)) throw Error('CONTINUATION_STAGE_FORBIDDEN');
      if(stage && !current.authorization.dispatchStages.includes(stage as typeof continuationStages[number])) throw Error('CONTINUATION_STAGE_NOT_AUTHORIZED');
      // New ambiguous sends never inherit the original probe's local-reuse authorization.
      const scan=async(root:string):Promise<void>=>{
        let entries:string[];try {entries=await readdir(root);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
        for(const name of entries) {
          const path=join(root,name),s=await lstat(path);
          if(s.isDirectory()) await scan(path);
          else if(name.endsWith('.tmp')) throw Error('CONTINUATION_INTERRUPTED_WRITE_REQUIRES_REVIEW');
          else if(!s.isFile()) throw Error('INVALID_CONTINUATION_FILE');
          else if(name.endsWith('.dispatch-attempt.json')) {
            const receipt=await optionalRecord(path.replace('.dispatch-attempt.json','.dispatch-receipt.json'));
            if(!receipt || receipt.outcome!=='command-returned') throw Error('CONTINUATION_AMBIGUOUS_DISPATCH_REQUIRES_NEW_REVIEW');
          }
        }
      };
      await scan(p.executionRoot);
      await auditHead();
      if(stage==='PLAN') {
        const agent=agentFor(stage);
        if(!agent) throw Error('DECLARED_CAPABLE_AGENT_REQUIRED');
        await verifyPlan(agent,centralStageRoutes.PLAN.request);
        requireMaestriSessionBoundDispatch();
      }
    };
    await gate();
    // Preflight the next stage before even creating the continuation directory.
    const checkpoint=await optionalRecord(join(p.executionRoot,options.id+'.checkpoint.json'));
    const next=continuationStages[checkpoint?.completed?.length ?? 0];
    if(next) await gate(next);
    for(const dir of [p.executionBase,p.executionRoot]) {await mkdir(dir,{recursive:true,mode:0o700});await regularDirectory(dir);}
    const marker={version:1,kind:'authorized-synthetic-continuation',jobId:options.id,recoveryDigest:initial.recoveryDigest,
      authorizationDigest:initial.authorizationDigest,originalDispatch:{outcome:'unknown',deliveryVerified:false},
      deliveryAuthenticated:false,authorshipAuthenticated:false,analyzeCompleted:false,planOnly:true,implementAuthorized:false};
    const markerFile=join(p.executionRoot,'continuation.json'),old=await optionalRecord(markerFile);
    if(old && dispatchDigest(old)!==dispatchDigest(marker)) throw Error('CONTINUATION_BINDING_CHANGED');
    if(!old) {
      if((await readdir(p.executionRoot)).length) throw Error('UNBOUND_CONTINUATION_DIRECTORY');
      await gate();await publishImmutable(markerFile,marker);
    }
    // Every outgoing request has a second gate at the executor boundary. No implicit probes.
    let probingAgent:string|undefined;
    const guardedTransport:MaestriTransport=async(command,args)=>{
      if(command==='ask') {
        // The executor has just claimed an attempt; scan would correctly reject it as incomplete.
        // Revalidate authority here without interpreting this in-flight claim as a previous send.
        const current=await inspectContinuationAuthorization(p.base,options.id);
        if(current.authorizationDigest!==initial.authorizationDigest) throw Error('CONTINUATION_AUTHORIZATION_CHANGED');
        if(probingAgent && (!current.authorization.capabilityProbeAgents.includes(probingAgent) || args[0]!==probingAgent)) throw Error('CONTINUATION_PROBE_NOT_AUTHORIZED');
      }
      return transport(command,args);
    };
    const executor=cliDispatchExecutor(guardedTransport);
    executor.authorize=async request=>{
      await gate(request.stage as Stage);
      if(request.jobId!==options.id || agentFor(request.stage as Stage)?.agentId!==request.agentId) throw Error('CONTINUATION_DISPATCH_NOT_AUTHORIZED');
    };
    const execute=executor.execute;
    executor.execute=async request=>{
      const current=await inspectContinuationAuthorization(p.base,options.id);
      if(current.authorizationDigest!==initial.authorizationDigest ||
          !current.authorization.dispatchStages.includes(request.stage as typeof continuationStages[number]) ||
          request.jobId!==options.id || agentFor(request.stage as Stage)?.agentId!==request.agentId) throw Error('CONTINUATION_DISPATCH_NOT_AUTHORIZED');
      if(request.stage==='PLAN') await verifyPlan(agentFor('PLAN'),centralStageRoutes.PLAN.request);
      return execute(request);
    };
    const result=await runCentralWorkflow({directory:p.executionBase,id:options.id,transport:guardedTransport,executor,
      pollMs:options.pollMs ?? 3000,maxPolls:12,syntheticMappingContract:true,pauseAfter:'PLAN',stopOnAmbiguousDispatch:true,
      authorize:gate,routingContext:marker,
      audit:async event=>{
        await gate();const head=await auditHead();
        await mkdir(auditDirectory,{recursive:true,mode:0o700});await regularDirectory(auditDirectory);
        await publishImmutable(join(auditDirectory,String(head.count+1).padStart(6,'0')+'.json'),{
          version:1,jobId:options.id,authorizationDigest:initial.authorizationDigest,sequence:head.count+1,
          previousDigest:head.digest,event,deliveryAuthenticated:false,authorshipAuthenticated:false});
      },
      async resolveRoute(stage,request) {
        await gate(stage);
        const agent=agentFor(stage);
        if(!agent) throw Error('DECLARED_CAPABLE_AGENT_REQUIRED');
        const listing=await transport('list',[]),names=parseConnectedAgentNames(listing);
        if(!names.includes(agent.agentId) || [...listing.matchAll(/name:\s*"([^"]{1,100})"/g)].filter(m=>m[1]===agent.agentId).length!==1) throw Error('DECLARED_AGENT_NOT_UNIQUELY_CONNECTED');
        if(stage==='PLAN') return await verifyPlan(agent,request);
        let proof;
        if(stage==='ANALYZE') {
          // Eligibility for this explicitly authorized local reuse, not delivery or authorship proof.
          proof={agentId:agent.agentId,capabilities:[...agent.capabilities],checkedAt:initial.authorization.issuedAt,
            artifactDigest:initial.recovery.resultDigest,taskId:initial.recovery.taskId};
        } else {
          if(!initial.authorization.capabilityProbeAgents.includes(agent.agentId)) throw Error('CONTINUATION_PROBE_NOT_AUTHORIZED');
          await gate(stage);probingAgent=agent.agentId;
          try {proof=await capabilityProbe(p.executionRoot,agent,guardedTransport,options.pollMs ?? 3000,true,()=>gate(stage));} finally {probingAgent=undefined;}
        }
        const decision=selectOperationalRoute({policy,agentId:agent.agentId,proof,connected:true,confirmed:true,now:Date.now(),
          request:{...request,signals:{taskKind:'read',affectedFiles:1,technicalRisk:'low',reasoningNeed:'low',confidence:1}}});
        return {...decision,operationalEvidence:{...decision.operationalEvidence as object,authorizationDigest:initial.authorizationDigest,
          recoveryDigest:initial.recoveryDigest,deliveryAuthenticated:false,authorshipAuthenticated:false}};
      }
    });
    return {version:1,jobId:options.id,status:'paused',executionMode:options.transport?'simulated':'real',realAcceptanceVerified:false,completed:result.completed,executionDirectory:p.executionRoot,
      planOnly:true,implementAuthorized:false,deliveryAuthenticated:false,authorshipAuthenticated:false};
  });
}
