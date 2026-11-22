import { sessionBindingDigest, type SessionAttestationProvider, type SessionAttestationRequest, type SessionAttestation } from '../../src/sessions/session-attestation.js';
// Synthetic response generator for integration tests only. Never used by production CLI.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type { MaestriTransport } from '../../src/integrations/maestri-central-cli.js';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const json = async (file:string) => JSON.parse(await readFile(file,'utf8'));
export function syntheticOperationalAgent(calls:string[]): MaestriTransport {
 return async (command,args) => {
  calls.push(command+':'+(args[0]??''));
  if(command==='list') return 'name: "Analytics"\nname: "UE-Pattern"\nname: "Hermes"';
  if(command==='check') return 'no model metadata';
  const prompt=args[1];
  if(prompt.includes('isolated capability task')) {
   const root=prompt.match(/Work ONLY in (.+)\./)![1],task=await json(join(root,'CAPABILITY.task.json'));
   await writeFile(join(root,'capability.json'),JSON.stringify({ version:1,jobId:basename(root),taskId:task.taskId,nonce:task.nonce,analysis:{componentCount:2},mapping:{hero:'demo/components/hero',text:'demo/components/text'},planning:['analyze','map','implement','validate'],coding:'export const componentCount = 2;',validation:['broken'] }));
   return 'ACK';
  }
  const file=prompt.match(/Write a JSON result file at (.+) with taskId equal to/)![1],root=dirname(file);
  const [,taskId,stage]=prompt.match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/)!;
  const artifacts:{file:string;digest:string}[]=[];
  const artifact=async(file:string,value:unknown)=>{ const bytes=JSON.stringify(value); await writeFile(join(root,file),bytes);artifacts.push({file,digest:hash(bytes)}); };
  await artifact(stage+'.evidence.json',{version:1,findings:['synthetic integration fixture'],limitations:['not real agent evidence']});
  if(stage==='MAP_COMPONENTS') await artifact('MAP_COMPONENTS.mapping.json',{ version:1,jobId:basename(root),taskId,stage,analyzeResultDigest:hash(await readFile(join(root,'ANALYZE.result.json'),'utf8')),scope:'synthetic-only',corporateReuseVerified:false,mapping:{source:'hero',component:'semantic-hero',heading:'Explore the imaginary garden',cta:'Discover the garden',href:'#garden',targetId:'garden'},semantics:['main and h1'],responsiveRequirements:['media query'],gaps:['corporate reuse unknown'],limitations:['browser not tested'] });
  if(stage==='PLAN') {
   const m=await json(join(root,'MAP_COMPONENTS.mapping.json'));
   const plannedFiles = JSON.parse(prompt.match(/plannedFiles:(\[[^\]]+\])/)! [1]);
   await artifact('PLAN.plan.json',{version:1,jobId:basename(root),taskId,stage,scope:'synthetic-only',corporateReuseVerified:false,implementationAuthorized:false,mappingFile:'MAP_COMPONENTS.mapping.json',mappingDigest:hash(await readFile(join(root,'MAP_COMPONENTS.mapping.json'),'utf8')),analyzeResultDigest:m.analyzeResultDigest,reusedComponents:[],componentsToImplement:['semantic-hero'],plannedFiles,dependencies:[],risks:['browser unknown'],blockers:[],requirements:m.mapping,semantics:m.semantics,responsiveRequirements:m.responsiveRequirements,knownLimitations:m.limitations,decisions:[{kind:'gap',index:0,source:m.gaps[0],decision:'synthetic only',acceptanceCriteria:['static check'],testIds:['static']},{kind:'limitation',index:0,source:m.limitations[0],decision:'human browser review',acceptanceCriteria:['static check'],testIds:['static']}],implementationPlan:{file:plannedFiles[0],steps:['render semantic hero']},acceptanceCriteria:['correct text'],proposedTests:[{id:'static',method:'static',procedure:'inspect heading',expected:'fixture title',status:'proposed'}]});
  }
  if(stage==='IMPLEMENT') await writeFile(join(root,'index.html'),'<html lang="en"><style>@media(max-width:600px){main{padding:1rem}}</style><main><h1>Explore the imaginary garden</h1><a href="#garden">Discover the garden</a><section id="garden">Garden</section></main></html>');
  await writeFile(file,JSON.stringify({version:2,jobId:basename(root),taskId,stage,status:'completed',summary:'Simulated specialist',evidence:['Synthetic fixture only'],artifacts}));
  return 'ACK';
 };
}

/** Synthetic provider only for tests. Never imported by production. */
export function syntheticSessionAttestation(request: SessionAttestationRequest): SessionAttestation {
  const binding={agentId:'Hermes',workspaceId:'fixture-workspace',terminalId:'fixture-terminal',sessionId:'fixture-session',
    provider:'codex' as const,modelId:'gpt-6-astra',profile:'ADVANCED' as const,capabilities:['planning','coding'],available:true as const};
  return {version:1,status:'verified',issuer:'test-session-provider',challenge:request.challenge,
    issuedAt:request.requestedAt,expiresAt:new Date(Date.parse(request.requestedAt)+60000).toISOString(),binding,
    evidence:{reference:'test-only-evidence',bindingDigest:sessionBindingDigest(binding),identityVerified:true,
      modelVerified:true,profileVerified:true,capabilitiesVerified:true,availabilityVerified:true}};
}
export const syntheticSessionAttestationProvider: SessionAttestationProvider={id:'test-session-provider',
  async attest(request) {return syntheticSessionAttestation(request);}};
