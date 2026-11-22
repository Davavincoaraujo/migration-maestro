import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requestSessionAttestation, sessionIdentity, type SessionAttestationProvider } from '../sessions/session-attestation.js';
import { selectVerifiedOperationalPlan, type AgentDeclaration } from '../ai/operational-routing.js';
import type { AdaptiveRouteRequest } from '../ai/model-router.js';
import { maestriSessionAttestationProvider } from './maestri-session-attestation.js';

/** Per-execution pin prevents a session switch between gate, routing and dispatch checks. */
export function operationalSessionGate(provider:SessionAttestationProvider=maestriSessionAttestationProvider(), executionRoot?:string) {
  let pinned:string|undefined;
  return async (agent:AgentDeclaration,request:AdaptiveRouteRequest) => {
    if(agent.agentId!=='Hermes' || !agent.modelId || agent.provider==='unknown' || !agent.capabilities.includes('planning')) throw Error('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED');
    const result=await requestSessionAttestation(provider,{agentId:agent.agentId,provider:agent.provider,modelId:agent.modelId,profile:'ADVANCED',capability:'planning'});
    if(result.status!=='verified') throw Error('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED',{cause:Error(result.reason)});
    const identity=sessionIdentity(result.binding);
    if(pinned && pinned!==identity) throw Error('SESSION_ATTESTATION_BINDING_CHANGED');
    // A persisted PLAN intent stays bound to its original attested session across process restarts.
    if(executionRoot) {
      const routeFile=join(executionRoot,'PLAN.route.json');
      let route:any;
      try {const stat=await lstat(routeFile);if(!stat.isFile() || stat.size>256000)throw Error('SESSION_ATTESTATION_ROUTE_INVALID');route=JSON.parse(await readFile(routeFile,'utf8'));}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const taskExists=await lstat(join(executionRoot,'PLAN.task.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
      if(route?.selected || taskExists) {
        const prior=route?.selected?.operationalEvidence?.sessionAttestation?.binding;
        if(!prior || sessionIdentity(prior)!==identity) throw Error('SESSION_ATTESTATION_BINDING_CHANGED');
      }
    }
    const decision=selectVerifiedOperationalPlan(agent,result,request);
    pinned=identity;return decision;
  };
}
