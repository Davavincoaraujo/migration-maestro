import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planHermesDemand, type HermesDemand } from "./core/hermes/plan.js";
import { prepareLocalFeatureWorktrees } from "./core/hermes/local-worktrees.js";
const [manifest,root,flag]=process.argv.slice(2);
if(!manifest){console.error("Uso: npm run hermes -- <demanda.json> [portal-local] [--approve-worktrees]");process.exitCode=1;}
else{
 try{
  const raw=await readFile(resolve(manifest),"utf8");
  if(raw.length>100000)throw new Error("MANIFEST_TOO_LARGE");
  const plan=planHermesDemand(JSON.parse(raw) as HermesDemand);
  const worktrees=root?await prepareLocalFeatureWorktrees({portalRoot:root,plan,approved:flag==="--approve-worktrees"}):undefined;
  if(flag&&flag!=="--approve-worktrees")throw new Error("UNKNOWN_FLAG");
  console.log(JSON.stringify({plan,worktrees},null,2));
 }catch(e){console.error(e instanceof Error?e.message:"HERMES_ERROR");process.exitCode=1;}
}
