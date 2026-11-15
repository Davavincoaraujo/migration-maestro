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
    const fence=text.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);
    if(fence){try{visit(JSON.parse(fence[1]),0);}catch{/* not structured */}}
   }
  } else visit(block,0);
 }
 return [...found];
}

export async function runCatalogDiscovery(directory: string|undefined, blocks: unknown[], onEvent:(message:string)=>void){
 const queries=extractComponentQueries(blocks);
 if(!queries.length)return {status:"needs_component_review" as const,queries:[],results:[]};
 const results: {query:string;candidateCount:number;rejectedRecords:number}[]=[];
 for(const query of queries){
  onEvent("Consultando catálogo para componente: "+query);
  const response=await fetchAnalystCatalogLocal(directory,{tool:"search_component_catalog",query,limit:5});
  const matches=buildMatchingPlan(response.content);
  results.push({query,candidateCount:matches.candidates.length,rejectedRecords:matches.rejectedRecords});
 }
 return {status:"review_required" as const,queries,results};
}
