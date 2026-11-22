import { randomUUID } from 'node:crypto';
import { routeAdaptiveTask, type AdaptiveModelCandidate } from '../ai/model-router.js';
import { centralStageRoutes } from '../integrations/maestri-model-router.js';
import { bounded,digest,roles,teamStages,verifyEvidence,type AgentRuntimeTransport,type RuntimeSession,type TeamStage,type TrustAnchor } from './contracts.js';

const token=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
export class AgentRuntimeRegistry {
  private observations:Record<string,unknown[]>={};
  private sessions=new Map<string,{session:RuntimeSession;expiresAt:number}>();
  readonly diagnostics:{transportId:string;reason:string}[]=[];
  constructor(readonly transports:readonly AgentRuntimeTransport[],readonly anchors:readonly TrustAnchor[],readonly mode:'live'|'simulation'='live') {
    if(new Set(transports.map(t=>t.id)).size!==transports.length||new Set(anchors.map(a=>a.transportId)).size!==anchors.length)throw Error('RUNTIME_DUPLICATE_TRANSPORT');
  }
  transport(id:string) {
    const transport=this.transports.find(t=>t.id===id),anchor=this.anchors.find(a=>a.transportId===id);
    if(!transport||!anchor||anchor.mode!==this.mode||transport.mode!==this.mode||!/^[a-f0-9]{64}$/.test(anchor.moduleDigest))throw Error('RUNTIME_TRUST_REQUIRED');
    if(!(['discovery','sessionBoundDispatch','reconciliation','results'] as const).every(k=>transport.support?.[k]===true))throw Error('RUNTIME_TRANSPORT_UNSUPPORTED');
    return {transport,anchor};
  }
  async refresh() {
    this.sessions.clear();this.diagnostics.length=0;this.observations={};
    await Promise.all(this.transports.map(async t=>{
      try {
        const {transport,anchor}=this.transport(t.id),challenge=randomUUID();
        if(transport.observations)this.observations[t.id]=await bounded(signal=>transport.observations!(signal));
        const proofs=await bounded(signal=>transport.discover(challenge,signal));
        if(!Array.isArray(proofs)||proofs.length>100)throw Error('RUNTIME_DISCOVERY_INVALID');
        const pending=new Map<string,{session:RuntimeSession;expiresAt:number}>();
        for(const proof of proofs) {
          const {session:s,guarantees:g}=verifyEvidence(proof,anchor,'session',challenge);
          if(s?.version!==2||s.transportId!==t.id||!['codex','claude-code'].includes(s.provider)||!['ECONOMY','BALANCED','ADVANCED'].includes(s.profile)||
            ![s.agentId,s.modelId,s.sessionId,s.connectionId,s.workspaceId].every(token)||typeof s.available!=='boolean'||
            !Array.isArray(s.capabilities)||!s.capabilities.length||s.capabilities.length>20||!s.capabilities.every(token)||new Set(s.capabilities).size!==s.capabilities.length||
            !(s.address?.kind==='runtime'&&s.address.protocol===(s.provider==='codex'?'codex-app-server':'claude-agent-sdk')||s.address?.kind==='maestri'&&token(s.address.terminalId))||
            !g||['identity','model','profile','capabilities','availability','scopeEnforced'].some(k=>g[k as keyof typeof g]!==true))throw Error('RUNTIME_SESSION_UNVERIFIED');
          const key=JSON.stringify([s.transportId,s.sessionId,s.connectionId]);
          if(pending.has(key))throw Error('RUNTIME_SESSION_DUPLICATE');
          pending.set(key,{session:s,expiresAt:Date.parse(proof.expiresAt)});
        }
        const qualified=new Set([...pending.values()].map(v=>v.session.sessionId));
        for(const observation of this.observations[t.id]??[]) {
          const o=observation as {sessionId?:string;diagnostics?:string[]};
          if(o.sessionId&&!qualified.has(o.sessionId))this.diagnostics.push({transportId:t.id,reason:o.diagnostics?.join(',')||'RUNTIME_SESSION_NOT_QUALIFIED'});
        }
        for(const [key,value] of pending)this.sessions.set(key,value);
      }catch(e){this.diagnostics.push({transportId:t.id,reason:e instanceof Error?e.message:'RUNTIME_DISCOVERY_FAILED'});}
    }));
    return this.report();
  }
  current():RuntimeSession[] {return [...this.sessions.values()].filter(v=>v.expiresAt>Date.now()).map(v=>structuredClone(v.session));}
  assertSession(session:RuntimeSession) {
    if(!this.current().some(s=>s.available&&digest(s)===digest(session)))throw Error('RUNTIME_SESSION_CHANGED_OR_EXPIRED');
    return this.transport(session.transportId);
  }
  route(stage:TeamStage|'ORCHESTRATE') {
    const coordinator=stage==='ORCHESTRATE';
    const role=coordinator?'Migration Orchestrator':roles[stage];
    const all=this.current().filter(s=>s.available&&(!role||s.agentId===role));
    const candidates:AdaptiveModelCandidate[]=all.map(s=>({id:digest(s),provider:s.provider,modelId:s.modelId,profile:s.profile,capabilities:s.capabilities,availability:'available',source:'verified-runtime'}));
    const request=coordinator?{taskType:'coordination',capability:'coordination',signals:{taskKind:'architecture' as const,affectedFiles:8,dependencyCount:4,technicalRisk:'high' as const,reasoningNeed:'high' as const,confidence:0.45}}:centralStageRoutes[stage].request;
    const decision=routeAdaptiveTask(candidates,request);
    const session=decision.action==='agent'?all.find(s=>digest(s)===decision.agentId):undefined;
    if((coordinator||stage==='PLAN'||stage==='IMPLEMENT')&&session?.profile!=='ADVANCED')return {decision:{...decision,action:'blocked' as const,reason:'VERIFIED_ADVANCED_SESSION_REQUIRED'},session:undefined};
    return {decision:session?{...decision,agentId:session.agentId}:decision,session};
  }
  report() {return {mode:this.mode,observations:this.observations,sessions:this.current(),diagnostics:this.diagnostics,routes:Object.fromEntries(['ORCHESTRATE',...teamStages].map(s=>[s,this.route(s as TeamStage|'ORCHESTRATE')]))};}
}
