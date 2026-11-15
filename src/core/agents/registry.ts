import type { AgentAdapter, AgentDefinition, ModelDefinition, TaskDefinition, ToolDefinition } from "../contracts/index.js";
const idPattern=/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;
function unique(values:readonly string[]):boolean{return new Set(values).size===values.length;}
function validNames(values:unknown):values is string[]{return Array.isArray(values)&&values.length<=100&&values.every(x=>typeof x==="string"&&idPattern.test(x))&&unique(values);}
export class AgentRegistry {
  private agents=new Map<string,AgentDefinition>();
  private adapters=new Map<string,AgentAdapter>();
  private tools=new Map<string,ToolDefinition>();
  registerTool(tool:ToolDefinition):void{
    if(!tool||!idPattern.test(tool.id)||!idPattern.test(tool.adapter)||!["read","write","execute","publish","external"].includes(tool.effect)||this.tools.has(tool.id))throw new Error("INVALID_TOOL_REGISTRATION");
    this.tools.set(tool.id,{...tool});
  }
  registerAgent(agent:AgentDefinition,adapter:AgentAdapter):void{
    if(!agent||!idPattern.test(agent.id)||!idPattern.test(agent.adapter)||!validNames(agent.capabilities)||!validNames(agent.allowedTools)||
      (agent.preferredModels!==undefined&&!validNames(agent.preferredModels))||
      !adapter||adapter.id!==agent.adapter||this.agents.has(agent.id)||agent.allowedTools.some(id=>!this.tools.has(id)))throw new Error("INVALID_AGENT_REGISTRATION");
    this.agents.set(agent.id,{...agent,capabilities:[...agent.capabilities],allowedTools:[...agent.allowedTools],preferredModels:agent.preferredModels?[...agent.preferredModels]:undefined});
    this.adapters.set(agent.id,adapter);
  }
  candidates(task:TaskDefinition):AgentDefinition[]{
    return [...this.agents.values()].filter(agent=>agent.capabilities.includes(task.capability)&&task.toolIds.every(id=>agent.allowedTools.includes(id)))
      .sort((a,b)=>a.id.localeCompare(b.id)).map(agent=>({...agent,capabilities:[...agent.capabilities],allowedTools:[...agent.allowedTools],preferredModels:agent.preferredModels?[...agent.preferredModels]:undefined}));
  }
  adapter(agentId:string):AgentAdapter|undefined{return this.adapters.get(agentId);}
  tool(id:string):ToolDefinition|undefined{const tool=this.tools.get(id);return tool?{...tool}:undefined;}
  toolsFor(task:TaskDefinition):Map<string,ToolDefinition>{return new Map(task.toolIds.flatMap(id=>{const t=this.tool(id);return t?[[id,t] as const]:[];}));}
}
