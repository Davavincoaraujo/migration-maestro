import { discoverMaestriAgents } from "./adapters/maestri/discovery.js";
const result=await discoverMaestriAgents();
if(!result.available){
 console.error("Maestri não está acessível neste terminal ("+result.reason+"). Abra o workspace no aplicativo Maestri e execute novamente.");
 process.exitCode=1;
}else{
 console.log("Maestri — agentes visíveis no workspace atual:");
 console.log(result.agentsText||"(nenhum agente retornado)");
}
