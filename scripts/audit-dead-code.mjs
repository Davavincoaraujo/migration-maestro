import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, dirname, extname, join } from "node:path";
const root=resolve(".");
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(["node_modules",".git","dist","local-output"].includes(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
const files=(await walk(root)).map(p=>relative(root,p).replaceAll("\\","/"));
const source=files.filter(p=>p.startsWith("src/")&&p.endsWith(".ts"));
const tests=files.filter(p=>p.startsWith("tests/")&&p.endsWith(".ts"));
const pkg=JSON.parse(await readFile("package.json","utf8"));
const entries=new Set(Object.values(pkg.scripts??{}).flatMap(v=>[...String(v).matchAll(/src\/[\w/-]+\.ts/g)].map(m=>m[0])));
const imported=new Map(source.map(p=>[p,new Set()]));
for(const file of [...source,...tests]){
 const content=await readFile(file,"utf8");
 for(const m of content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']|import\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)){
  const spec=m[1]??m[2];
  if(!spec)continue;
  const base=resolve(dirname(resolve(file)),spec);
  const candidate=relative(root,base.replace(/\.js$/,".ts")).replaceAll("\\","/");
  if(imported.has(candidate))imported.get(candidate).add(file);
 }
}
const candidates=source.filter(p=>!entries.has(p)&&imported.get(p).size===0);
const report={sourceFiles:source.length,testFiles:tests.length,scriptEntrypoints:[...entries].sort(),potentiallyUnreferenced:candidates.map(path=>({path,reason:"No static TypeScript import/export or package script reference detected",requiresManualReview:true})),limitations:["Dynamic imports, runtime discovery, generated entrypoints and external consumers may not be detected.","No files are deleted by this audit.","Tests and documentation may depend on behavior not represented by imports."]};
process.stdout.write(JSON.stringify(report,null,2)+"\n");
