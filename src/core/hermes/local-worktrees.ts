import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { HermesPlan } from "./plan.js";
const exec=promisify(execFile);
const validBranch=/^feature\/hermes-[a-z0-9-]{1,120}$/;
async function git(cwd:string,...args:string[]):Promise<string>{
 const {stdout}=await exec("git",args,{cwd,timeout:10000,maxBuffer:65536,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}});
 return stdout.trim();
}
export interface WorktreePreparation { featureId:string;branch:string;path:string;status:"planned"|"created"; }
/** No changes unless explicitly approved. Never push, reset, commit, or touch existing worktrees. */
export async function prepareLocalFeatureWorktrees(input:{portalRoot:string;plan:HermesPlan;approved:boolean}):Promise<WorktreePreparation[]>{
 const root=await realpath(resolve(input.portalRoot));
 if(!(await stat(root)).isDirectory())throw new Error("INVALID_PORTAL_ROOT");
 const gitRoot=await realpath(await git(root,"rev-parse","--show-toplevel"));
 if(root!==gitRoot)throw new Error("PORTAL_ROOT_MISMATCH");
 if((await git(root,"status","--porcelain")).length)throw new Error("DIRTY_PORTAL_WORKTREE");
 const base=await git(root,"rev-parse","HEAD");
 if(!/^[0-9a-f]{40,64}$/.test(base))throw new Error("INVALID_BASE_COMMIT");
 const result:WorktreePreparation[]=[];
 for(const feature of input.plan.features){
  if(!validBranch.test(feature.branch))throw new Error("INVALID_FEATURE_BRANCH");
  const path=join(dirname(root),".hermes-worktrees",input.plan.demandId,feature.featureId);
  result.push({featureId:feature.featureId,branch:feature.branch,path,status:"planned"});
 }
 if(!input.approved)return result;
 // Refuse any existing branch or worktree to avoid overwriting local work.
 for(const item of result){
  try{await stat(item.path);throw new Error("WORKTREE_ALREADY_EXISTS");}
  catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  const exists=await git(root,"branch","--list",item.branch);
  if(exists)throw new Error("FEATURE_BRANCH_ALREADY_EXISTS");
 }
 for(const item of result){
  await exec("git",["worktree","add","-b",item.branch,item.path,base],{cwd:root,timeout:30000,maxBuffer:65536,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}});
  item.status="created";
 }
 return result;
}
