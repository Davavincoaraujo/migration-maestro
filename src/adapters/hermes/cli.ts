import { spawn } from "node:child_process";
import type { AgentAdapter, TaskDefinition } from "../../core/contracts/index.js";
export interface HermesCliConfig { executable:string; args:string[]; timeoutMs?:number; }
const safeExecutable=/^[a-zA-Z0-9._/-]{1,256}$/;
const safeArg=/^[a-zA-Z0-9._/-]{1,256}$/;
function validate(config:HermesCliConfig):void {
 if(!config||!safeExecutable.test(config.executable)||!Array.isArray(config.args)||config.args.length>12||
 config.args.some(a=>typeof a!=="string"||!safeArg.test(a))||
 !Number.isSafeInteger(config.timeoutMs??5000)||(config.timeoutMs??5000)<100||(config.timeoutMs??5000)>30000)
 throw new Error("INVALID_HERMES_CONFIG");
}
/** Local Hermes CLI probe. No shell, prompts, secrets, or undocumented agent invocation. */
export function probeHermesCli(config:HermesCliConfig):Promise<boolean>{
 validate(config);
 return new Promise(resolve=>{
  const child=spawn(config.executable,config.args,{shell:false,stdio:"ignore",env:{PATH:process.env.PATH??""}});
  let settled=false;
  const done=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{child.kill();done(false);},config.timeoutMs??5000);
  child.on("error",()=>done(false));
  child.on("close",code=>done(code===0));
 });
}
/** An adapter that refuses to fake execution until the actual Hermes harness protocol is configured. */
export class NousHermesAdapter implements AgentAdapter {
 readonly id="nous-hermes";
 constructor(private readonly probe:HermesCliConfig){}
 checkAvailability():Promise<boolean>{return probeHermesCli(this.probe);}
 async execute(_input:{runId:string;task:TaskDefinition;modelId?:string;worktree?:string}):Promise<{status:"review_required";evidenceIds:string[];errorCode:string}>{
  return {status:"review_required",evidenceIds:[],errorCode:"HERMES_EXECUTION_PROTOCOL_NOT_CONFIGURED"};
 }
}
