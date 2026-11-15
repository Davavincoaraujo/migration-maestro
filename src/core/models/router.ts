import type { AgentDefinition, ModelDefinition, TaskDefinition } from "../contracts/index.js";
export interface ModelRoutingRequest {
  task:TaskDefinition;
  agent:AgentDefinition;
  models:readonly ModelDefinition[];
  estimatedInputTokens:number;
  reservedOutputTokens:number;
  maxEstimatedCostUsd:number;
}
export interface ModelSelection { modelId:string; estimatedCostUsd:number; }
export function selectModel(request:ModelRoutingRequest):ModelSelection|null{
  const {task,agent,models,estimatedInputTokens,reservedOutputTokens,maxEstimatedCostUsd}=request;
  if(!Number.isSafeInteger(estimatedInputTokens)||estimatedInputTokens<0||!Number.isSafeInteger(reservedOutputTokens)||reservedOutputTokens<0||
     !Number.isFinite(maxEstimatedCostUsd)||maxEstimatedCostUsd<0||models.length>100)throw new Error("INVALID_ROUTING_REQUEST");
  const candidates=models.map(model=>{
    if(!model||!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(model.id)||!model.provider||
      !Array.isArray(model.capabilities)||model.capabilities.some(c=>typeof c!=="string")||
      !Number.isSafeInteger(model.contextWindow??1)||(model.contextWindow??1)<1||
      ![model.costPerMillionInputTokensUsd,model.costPerMillionOutputTokensUsd].every(n=>n===undefined||(Number.isFinite(n)&&n>=0)))throw new Error("INVALID_MODEL_DEFINITION");
    if(model.costPerMillionInputTokensUsd===undefined||model.costPerMillionOutputTokensUsd===undefined)return null;
    if(!model.capabilities.includes(task.capability)||estimatedInputTokens+reservedOutputTokens>(model.contextWindow??0))return null;
    if(agent.preferredModels?.length&&!agent.preferredModels.includes(model.id))return null;
    const cost=(estimatedInputTokens*model.costPerMillionInputTokensUsd+reservedOutputTokens*model.costPerMillionOutputTokensUsd)/1_000_000;
    return cost<=maxEstimatedCostUsd?{modelId:model.id,estimatedCostUsd:cost}:null;
  }).filter((v):v is ModelSelection=>v!==null).sort((a,b)=>a.estimatedCostUsd-b.estimatedCostUsd||a.modelId.localeCompare(b.modelId));
  return candidates[0]??null;
}
