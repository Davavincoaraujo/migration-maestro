import { spawn } from "node:child_process";
export interface MaestriDiscovery { available:boolean; command:string; agentsText?:string; reason?:string; }
/** Maestri is the primary UI. Discovery uses its documented local CLI, not private app files or undocumented APIs. */
export async function discoverMaestriAgents(timeoutMs=5000):Promise<MaestriDiscovery>{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new Error("INVALID_TIMEOUT");
  return await new Promise(resolve=>{
    const child=spawn("maestri",["list"],{shell:false,stdio:["ignore","pipe","pipe"],env:process.env});
    let output="";let settled=false;
    const finish=(value:MaestriDiscovery)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish({available:false,command:"maestri list",reason:"TIMEOUT"});},timeoutMs);
    child.stdout?.on("data",(chunk:Buffer)=>{if(output.length<65536)output+=chunk.toString("utf8").slice(0,65536-output.length);else child.kill();});
    child.stderr?.on("data",()=>{});
    child.on("error",()=>finish({available:false,command:"maestri list",reason:"CLI_UNAVAILABLE"}));
    child.on("close",code=>{
      if(output.length>=65536)return finish({available:false,command:"maestri list",reason:"OUTPUT_TOO_LARGE"});
      if(code!==0)return finish({available:false,command:"maestri list",reason:"CLI_FAILED"});
      finish({available:true,command:"maestri list",agentsText:output});
    });
  });
}
