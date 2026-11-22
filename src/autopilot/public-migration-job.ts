import { createHash } from 'node:crypto';
import { mkdir, open, readFile, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atendimentoUrl, inspectPublicHtml, readPublicPage, validatePublicDiscoveryUrl } from '../integrations/public-page-discovery.js';
import { routeMaestriStage, centralStageRoutes } from '../integrations/maestri-model-router.js';
import { readModelRouterConfig } from '../ai/model-router-config.js';
import { validateOperationalPolicy, type AgentDeclaration } from '../ai/operational-routing.js';
import { migrationStages } from './central-controller.js';

const rootDefault=resolve('.local-maestro/public-migrations');
const roleFor:Record<string,string>={ANALYZE:'Analytics',DISCOVER_COMPONENTS:'UE-Pattern',MAP_COMPONENTS:'UE-Pattern',PLAN:'Hermes',IMPLEMENT:'Hermes',VALIDATE:'Validator'};
const routeFor:Record<string,string>={ANALYZE:'ANALYZE',DISCOVER_COMPONENTS:'DISCOVER_COMPONENTS',MAP_COMPONENTS:'MAP_COMPONENTS',PLAN:'PLAN',IMPLEMENT:'IMPLEMENT',VALIDATE:'VALIDATE'};
const dependencies:Record<string,string[]>={ANALYZE:[],DISCOVER_COMPONENTS:['ANALYZE'],MAP_COMPONENTS:['ANALYZE','DISCOVER_COMPONENTS'],PLAN:['MAP_COMPONENTS'],IMPLEMENT:['PLAN'],VALIDATE:['IMPLEMENT']};
async function atomicJson(path:string,value:unknown) {
  const temp=path+'.'+cryptoRandom()+'.pending';
  try {await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);}
  finally {await rm(temp,{force:true});}
}
const cryptoRandom=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
async function readPolicy():Promise<AgentDeclaration[]> {
  const policy=validateOperationalPolicy(JSON.parse(await readFile(resolve('config/operational-agents.json'),'utf8')));
  const model=await readModelRouterConfig();
  return policy.agents.map(a=>({ ...a, capabilities:[...(model.capabilitiesByAgent[a.agentId]??[])] }));
}
export async function preparePublicMigrationJob(url:string,options:{baseDirectory?:string;read?:typeof readPublicPage}={}) {
  const source=validatePublicDiscoveryUrl(url),base=resolve(options.baseDirectory??rootDefault),id=sha(source).slice(0,20),directory=join(base,id);
  await mkdir(base,{recursive:true,mode:0o700});
  // A per-URL exclusive lock makes retries idempotent and concurrent creation fail closed.
  const lock=join(base,id+'.lock');let handle;
  try {handle=await open(lock,'wx',0o600);}catch{throw Error('PUBLIC_MIGRATION_JOB_LOCKED');}
  try {
    try {
      const stat=await lstat(directory);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('PUBLIC_MIGRATION_JOB_INVALID');
      const old=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
      if(old.url!==source||old.jobId!==id)throw Error('PUBLIC_MIGRATION_JOB_CONFLICT');
      return JSON.parse(await readFile(join(directory,'status.json'),'utf8'));
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    await mkdir(directory,{mode:0o700});
    const workspace=join(directory,'workspace');await mkdir(workspace,{mode:0o700});
    const manifest={version:1,jobId:id,url:source,createdAt:new Date().toISOString(),kind:'public-readonly-discovery',workspace,
      sourcePolicy:{method:'single HTTPS GET',scriptsExecuted:false,assetsFetched:false,linksFollowed:false,formsSubmitted:false,aemWrites:false,published:false},
      taskDelivery:{state:'not-dispatched',dispatchCount:0,receipt:null as null}};
    await atomicJson(join(directory,'manifest.json'),manifest);
    const checkpoint={version:1,jobId:id,completed:['validate-url','prepare-job','prepare-workspace'],outputs:{},state:'running',updatedAt:new Date().toISOString()};
    await atomicJson(join(directory,'checkpoint.json'),checkpoint);
    let discovery:any,sourceState='blocked',sourceReason:string|undefined;
    try {
      const fetched=await (options.read??readPublicPage)(source);
      discovery=inspectPublicHtml(fetched.html,source);
      await atomicJson(join(directory,'evidence.json'),{version:1,jobId:id,capturedAt:fetched.capturedAt,sourceDigest:discovery.sourceDigest,
        title:discovery.title,headings:discovery.headings,links:discovery.links,faq:discovery.faq,forms:discovery.forms,sensitive:discovery.sensitive,
        componentCandidates:discovery.candidates,limitations:discovery.limitations,sourceHtmlPersisted:false});
      sourceState='completed';checkpoint.completed.push('public-source-discovery');
    }catch(e){sourceReason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PUBLIC_SOURCE_DISCOVERY_FAILED';}
    const agents=await readPolicy();
    const tasks=migrationStages.filter(stage=>roleFor[stage]).map(stage=>{
      const agentId=roleFor[stage],declared=agents.find(a=>a.agentId===agentId),request=centralStageRoutes[routeFor[stage]].request;
      // Declarations identify candidates only. The router sees no verified live sessions, so it cannot select a runnable model.
      const decision=routeMaestriStage(routeFor[stage],[]);
      const blockers=[...(sourceState!=='completed'?['PUBLIC_SOURCE_DISCOVERY_REQUIRED']:[]),decision.reason,
        'VERIFIED_SESSION_AND_SESSION_BOUND_DISPATCH_REQUIRED','TASK_NOT_DISPATCHED'];
      return {taskId:stage.toLowerCase().replaceAll('_','-'),stage,agentCandidate:declared?agentId:null,
        modelCandidate:declared?.modelId?{provider:declared.provider,modelId:declared.modelId,profile:'declared-only'}:null,
        routeDecision:{action:decision.action,reason:decision.reason??'CANDIDATE_ROUTE_ONLY'},dependencies:dependencies[stage],status:blockers.length?'blocked':'ready',
        readiness:blockers.length?'blocked':'ready',blockers,dispatch:{state:'not-dispatched',delivered:false,receipt:null},
        completionCriteria:[`Create and validate ${stage.toLowerCase()} result artifact`, 'Verify request, session and result provenance', 'Persist hash-bound checkpoint']};
    });
    const pending=tasks.filter(t=>t.status==='ready').length,blocked=tasks.filter(t=>t.status==='blocked').length;
    const status={version:1,jobId:id,url:source,state:sourceState==='completed'?'prepared-blocked':'blocked',sourceDiscovery:sourceState,...(sourceReason?{reason:sourceReason}:{}),workspace,
      summary:{completed:sourceState==='completed'?1:0,ready:pending,blocked,planned:tasks.length,dispatched:0},tasks,authorization:{requiredForAgentDispatch:true,granted:false},
      externalWrites:{aem:0,publish:0,deploy:0},manifest:join(directory,'manifest.json'),checkpoint:join(directory,'checkpoint.json'),evidence:sourceState==='completed'?join(directory,'evidence.json'):null};
    await atomicJson(join(directory,'plan.json'),{version:1,jobId:id,orchestrator:'Autopilot/runCentralWorkflow stage contract',router:'Model Router/routeMaestriStage',tasks});
    checkpoint.state=status.state;checkpoint.updatedAt=new Date().toISOString();
    if(sourceState==='completed')checkpoint.completed.push('plan-and-routing');
    await atomicJson(join(directory,'checkpoint.json'),checkpoint);
    await atomicJson(join(directory,'status.json'),status);
    return status;
  }finally{await handle?.close();await rm(lock,{force:true});}
}
export const publicMigrationRoot=rootDefault;
export { atendimentoUrl };
