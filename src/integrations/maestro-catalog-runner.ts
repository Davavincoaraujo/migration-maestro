import { evaluateUeValidationGate } from "./ue-validation-gate.js";
import { buildMatchingPlan } from "./component-matching-engine.js";
import { fetchAnalystCatalogLocal } from "./local-analyst-catalog.js";
/** Conservative keyword extraction: never assume arbitrary page text is a component specification. */
export function extractComponentQueries(blocks: unknown[]): string[] {
 const found = new Set<string>();
 const allowed = /^(carousel|banner|accordion|faq|hero|card|cards|tabs|form|header|footer|navigation|breadcrumb|image|video|table|slider|button|modal|grid|text|teaser)$/i;
 const keys = new Set(["component","componentType","resourceType","name","components","componentName","component_type","resource_type","tagName","tag"]);
 function visit(value: unknown, depth: number): void {
  if(depth > 10 || found.size >= 12 || !value || typeof value !== "object") return;
  if(Array.isArray(value)){for(const item of value.slice(0,150))visit(item,depth+1);return;}
  for(const [key,item] of Object.entries(value).slice(0,150)){
   if(keys.has(key)&&typeof item==="string"){
    const token=item.split("/").pop()?.trim()??"";
    if(allowed.test(token))found.add(token.toLowerCase());
   }
   if(item && typeof item==="object")visit(item,depth+1);
  }
 }
 for(const block of blocks.slice(0,8)){
  if(!block || typeof block!=="object")continue;
  const item=block as {type?:unknown;text?:unknown};
  if(item.type==="text"&&typeof item.text==="string"&&item.text.length<500000){
   try{visit(JSON.parse(item.text),0);}catch{
    // MCP output can wrap JSON in Markdown fences or prose. Parse only balanced JSON objects.
    const text=item.text;
    const fence=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(fence){try{visit(JSON.parse(fence[1]),0);}catch{/* not structured */}}
   }
  } else visit(block,0);
 }
 return [...found];
}

export type DiscoveryResult = {
 status:"review_required"|"needs_component_review";
 queries:string[];
 results:{query:string;candidateCount:number;rejectedRecords:number;inspected:number;inspectionFailed:number;ueValidation:"passed"|"passed_with_warnings"|"failed"|"unverified"|"blocked"|"unavailable"|"not_run";ueErrors:number|null;ueWarnings:number|null}[];
};
export async function runCatalogDiscovery(directory: string|undefined, blocks: unknown[], onEvent:(message:string)=>void){
 const queries=extractComponentQueries(blocks);
 if(!queries.length)return {status:"needs_component_review" as const,queries:[],results:[]};
 const results: DiscoveryResult["results"]=[];
 for(const query of queries){
  onEvent("Consultando catálogo para componente: "+query);
  const response=await fetchAnalystCatalogLocal(directory,{tool:"search_component_catalog",query,limit:5});
  const matches=buildMatchingPlan(response.content);
  let inspected=0,inspectionFailed=0;
  let ueValidation: DiscoveryResult["results"][number]["ueValidation"]="not_run";
  let ueErrors:number|null=null,ueWarnings:number|null=null;
  // Inspect only the top candidate. A search score alone is not proof of compatibility.
  const candidate=matches.candidates[0];
  if(candidate){
   onEvent("Inspecionando candidato do catálogo para: "+query);
   try{
    const inspectedResult=await fetchAnalystCatalogLocal(directory,{tool:"inspect_component",idOrName:candidate.id});
    if(inspectedResult.content.length>0)inspected=1;
    else inspectionFailed=1;
   }catch{inspectionFailed=1;onEvent("Inspeção indisponível para: "+query);}
   // UE CLI accepts a local relative component path, never an arbitrary catalog identifier.
   if(inspected && /^[a-zA-Z0-9_-]+(?:\\/[a-zA-Z0-9_-]+)*$/.test(candidate.id)&&candidate.id.length<=180){
    onEvent("Validando padrão UE para candidato de: "+query);
    const gate=await evaluateUeValidationGate(candidate.id);
    ueValidation=gate.validation;
    ueErrors=gate.errors;
    ueWarnings=gate.warnings;
   }
  }
  results.push({query,candidateCount:matches.candidates.length,rejectedRecords:matches.rejectedRecords,inspected,inspectionFailed,ueValidation,ueErrors,ueWarnings});
 }
 return {status:"review_required" as const,queries,results};
}
