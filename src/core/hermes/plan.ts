import type { WorkflowDefinition } from "../contracts/index.js";
import { validateWorkflow } from "../workflow/validate.js";
export interface HermesFeature { id:string; title:string; tasks:{id:string;title:string;dependsOn:string[]}[]; dependsOn?:string[]; }
export interface HermesDemand { id:string; title:string; features:HermesFeature[]; }
export interface HermesFeaturePlan { featureId:string; branch:string; tasks:{id:string;title:string;dependsOn:string[]}[]; dependsOn:string[]; }
export interface HermesPlan { demandId:string; title:string; workspace:"local"; requiresHumanApproval:true; features:HermesFeaturePlan[]; workflow:WorkflowDefinition; }
const id=/^[a-z][a-z0-9-]{0,49}$/;
function name(v:unknown):v is string{return typeof v==="string"&&v.trim().length>0&&v.length<=200;}
/** Pure, deterministic planning. No git, filesystem, model or MCP invocation. */
export function planHermesDemand(demand:HermesDemand):HermesPlan {
 if(!demand||!id.test(demand.id)||!name(demand.title)||!Array.isArray(demand.features)||demand.features.length<1||demand.features.length>30)throw new Error("INVALID_DEMAND");
 const features=new Set<string>(),tasks=new Set<string>();
 for(const feature of demand.features){
  if(!feature||!id.test(feature.id)||features.has(feature.id)||!name(feature.title)||
     !Array.isArray(feature.tasks)||feature.tasks.length<1||feature.tasks.length>30||
     (feature.dependsOn!==undefined&&!Array.isArray(feature.dependsOn)))throw new Error("INVALID_FEATURE");
  features.add(feature.id);
  for(const task of feature.tasks){
   if(!task||!id.test(task.id)||tasks.has(feature.id+"."+task.id)||!name(task.title)||
      !Array.isArray(task.dependsOn)||task.dependsOn.some(x=>typeof x!=="string"||!id.test(x)))throw new Error("INVALID_HERMES_TASK");
   tasks.add(feature.id+"."+task.id);
  }
 }
 const workflow:WorkflowDefinition={id:"hermes."+demand.id,version:1,tasks:[]};
 const planned:HermesFeaturePlan[]=[];
 for(const feature of demand.features){
  const deps=feature.dependsOn??[];
  if(deps.some(x=>typeof x!=="string"||!features.has(x)||x===feature.id)||new Set(deps).size!==deps.length)throw new Error("INVALID_FEATURE_DEPENDENCY");
  const localIds=new Set(feature.tasks.map(t=>t.id));
  for(const task of feature.tasks){
   if(task.dependsOn.some(x=>!localIds.has(x)||x===task.id)||new Set(task.dependsOn).size!==task.dependsOn.length)throw new Error("INVALID_TASK_DEPENDENCY");
   const globalId=feature.id+"."+task.id;
   workflow.tasks.push({id:globalId,label:task.title,capability:"coding",
     dependsOn:[...task.dependsOn.map(x=>feature.id+"."+x),...deps.flatMap(dep=>demand.features.find(f=>f.id===dep)!.tasks.map(t=>dep+"."+t.id))],
     toolIds:[],requiresApproval:true});
  }
  planned.push({featureId:feature.id,branch:"feature/hermes-"+demand.id+"-"+feature.id,
   dependsOn:[...deps],tasks:feature.tasks.map(t=>({...t,dependsOn:[...t.dependsOn]}))});
 }
 validateWorkflow(workflow);
 return {demandId:demand.id,title:demand.title,workspace:"local",requiresHumanApproval:true,features:planned,workflow};
}
