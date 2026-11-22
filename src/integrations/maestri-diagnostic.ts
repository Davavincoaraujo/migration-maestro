import { createHash } from 'node:crypto';
import { validateOperationalPolicy, type OperationalPolicy } from '../ai/operational-routing.js';
import { parseRenderedModelFooter } from './model-discovery.js';
import { MaestriCommandError, maestriTransport } from './maestri-central-cli.js';

/** Deliberately excludes ask and all mutation commands. No attestation-provider injection. */
export type MaestriDiagnosticTransport = (command:'list'|'check',args:string[])=>Promise<string>;
function failure(e:unknown) {
  if(e instanceof MaestriCommandError) return e.stderrClass==='permission-denied'?'IPC_PERMISSION_DENIED':
    e.message==='MAESTRI_TIMEOUT'?'IPC_TIMEOUT':'IPC_COMMAND_FAILED';
  return 'IPC_COMMAND_FAILED';
}
function listing(raw:string) {
  const header=/Connected agents:\s*/i.exec(raw);
  const section=header?raw.slice(header.index+header[0].length).split(/Connected (?:notes|portals|agents)\b/i)[0]:raw;
  const matches=[...section.matchAll(/^\s*(?:-\s*)?name:\s*"([^"\r\n]{1,100})"\s*$/gm)];
  const mentions=[...section.matchAll(/\bname\s*:/g)].length;
  const valid=(Boolean(header)||matches.length>0) && mentions===matches.length && matches.every(m=>/^[A-Za-z0-9][A-Za-z0-9 @()._-]{0,99}$/.test(m[1]));
  const names=valid?matches.map(m=>m[1]):[];
  return {valid,names,digest:createHash('sha256').update(raw).digest('hex')};
}
/** Two bounded observations, no retries on initial failure and no raw transcript output or storage. */
export async function diagnoseMaestri(options:{policy:OperationalPolicy;observeModel?:boolean;transport?:MaestriDiagnosticTransport}) {
  const policy=validateOperationalPolicy(options.policy);
  const transport=options.transport ?? maestriTransport(undefined,3000);
  const samples:{at:string;ipc:{commandReturned:boolean;diagnostic:string|null};listingValid:boolean;
    agents:{agentId:string;nameObservation:string;modelObservation:{state:string;visibleModel:string|null;diagnostic:string|null}}[]}[]=[];
  const digests:string[]=[];
  for(let i=0;i<2;i++) {
    const sample:{at:string;ipc:{commandReturned:boolean;diagnostic:string|null};listingValid:boolean;agents:typeof samples[number]['agents']}=
      {at:new Date().toISOString(),ipc:{commandReturned:false,diagnostic:null},listingValid:false,agents:[]};
    samples.push(sample);
    let parsed:ReturnType<typeof listing>;
    try {
      const raw=await transport('list',[]);
      if(typeof raw!=='string' || Buffer.byteLength(raw)>128000) throw Error('INVALID_DIAGNOSTIC_RESPONSE');
      sample.ipc.commandReturned=true;parsed=listing(raw);sample.listingValid=parsed.valid;digests.push(parsed.digest);
      if(!parsed.valid)sample.ipc.diagnostic='LIST_RESPONSE_INCONSISTENT';
    }catch(e){sample.ipc.diagnostic=failure(e);break;}
    for(const agent of policy.agents) {
      const count=parsed.names.filter(n=>n===agent.agentId).length;
      const observation={agentId:agent.agentId,nameObservation:!parsed.valid?'unknown':count===0?'not-observed':count===1?'observed':'ambiguous',
        modelObservation:{state:'unknown',visibleModel:null as string|null,diagnostic:options.observeModel?'NO_UNIQUE_AGENT_OBSERVATION':'NOT_REQUESTED' as string|null}};
      sample.agents.push(observation);
      if(options.observeModel && parsed.valid && count===1) {
        try {
          const screen=await transport('check',[agent.agentId]);
          if(typeof screen!=='string'||Buffer.byteLength(screen)>128000)throw Error('INVALID_DIAGNOSTIC_RESPONSE');
          const footer=parseRenderedModelFooter(screen);
          // Project only the recognized label. Neither the screen nor its digest is retained.
          observation.modelObservation=footer?{state:'observed-not-authenticated',visibleModel:footer.visibleModel,diagnostic:null}:
            {state:'unknown',visibleModel:null,diagnostic:'MODEL_NOT_EXPOSED'};
        }catch{observation.modelObservation.diagnostic='MODEL_CHECK_FAILED';}
      }
    }
  }
  const returned=samples.filter(s=>s.ipc.commandReturned).length;
  const comparable=samples.length===2 && samples.every(s=>s.ipc.commandReturned && s.listingValid);
  const responseChanged=digests.length===2?digests[0]!==digests[1]:null;
  return {version:1,readOnly:true,observedAt:new Date().toISOString(),
    ipc:{state:returned===0?'unavailable':returned===samples.length?'reachable':'intermittent',
      commandRoundTripVerified:returned>0,authenticatedPeerIdentity:false},samples,
    agents:policy.agents.map(agent=>{
      const observations=samples.map(s=>s.agents.find(a=>a.agentId===agent.agentId));
      const labels=observations.map(a=>a?.modelObservation.visibleModel ?? null);
      const modelChanged=labels.every(v=>v!==null)&&labels.length===2?labels[0]!==labels[1]:null;
      return {agentId:agent.agentId,
        declared:{source:'operational-policy',provider:agent.provider,modelId:agent.modelId,capabilities:agent.capabilities},
        requiredProfile:agent.capabilities.includes('planning')?'ADVANCED':null,
        sessionIdentity:{state:'unknown',verified:false,sessionId:null},
        activeModel:{state:'unknown',verified:false,observedLabels:labels},
        profile:{state:'unknown',verified:false},capabilities:{state:'unknown',verified:false},availability:{state:'unknown',verified:false},
        continuity:{state:'unknown',verified:false,responseChanged,modelObservationChanged:modelChanged,
          diagnostic:!comparable?'INSUFFICIENT_OBSERVATIONS':responseChanged||modelChanged?'OBSERVATIONS_CHANGED_SESSION_SWITCH_POSSIBLE':'UNCHANGED_OBSERVATIONS_DO_NOT_PROVE_SESSION_CONTINUITY'},
        attestation:{status:'unverified',reason:'MAESTRI_SESSION_ATTESTATION_UNSUPPORTED'}};
    }),
    dispatchBinding:{currentTransport:'official-maestri-cli',addressing:'agent-name',sessionBound:false,
      sessionSwitchRace:'unresolved',wireTerminalIdAddressing:'documented-not-integrated',
      providerSessionPrecondition:'not-established',source:'https://www.themaestri.app/en/docs/wire#terminals'},
    authorizationGranted:false,pipelineAdvanceAuthorized:false,deliveryAuthenticated:false,authorshipAuthenticated:false,
    plan:{status:'blocked',requires:['explicit-continuation-authorization','Hermes-ADVANCED-planning-attestation','verified-session-dispatch-binding']},
  };
}
