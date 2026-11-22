import { createHash } from 'node:crypto';
import { open, readFile, rename, rm, lstat, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { publicMigrationRoot } from './public-migration-job.js';
import { readPublicPage, inspectPublicHtml, validatePublicDiscoveryUrl, publicPageLimit } from '../integrations/public-page-discovery.js';

const sha=(bytes:string)=>createHash('sha256').update(bytes,'utf8').digest('hex');
async function json(path:string) { return JSON.parse(await readFile(path,'utf8')); }
async function save(path:string,value:unknown,raw=false) {
  const temp=path+'.pending';
  await rm(temp,{force:true});
  const handle=await open(temp,'wx',0o600);
  try { await handle.writeFile(raw?String(value):JSON.stringify(value,null,2)+'\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp,path);
}
/** Operator attestation is recorded, not independently verified. The UTF-8 file is never executed. */
export async function validatePublicSnapshot(path:string,url:string) {
  const handle=await open(path,'r');
  let snapshot;
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>publicPageLimit*6+4096)throw Error('PUBLIC_SNAPSHOT_SIZE_LIMIT');
    snapshot=JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
  if(snapshot.version!==1 || snapshot.url!==url || validatePublicDiscoveryUrl(snapshot.url)!==url ||
    snapshot.legitimatelyCaptured!==true || typeof snapshot.operator!=='string' || !snapshot.operator.trim() || snapshot.operator.length>200 ||
    typeof snapshot.capturedAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(snapshot.capturedAt) ||
    !Number.isFinite(Date.parse(snapshot.capturedAt)) || Date.parse(snapshot.capturedAt)>Date.now() ||
    typeof snapshot.html!=='string' || snapshot.sha256!==sha(snapshot.html))throw Error('PUBLIC_SNAPSHOT_INVALID');
  inspectPublicHtml(snapshot.html,url);
  return {html:snapshot.html,capturedAt:snapshot.capturedAt,provenance:{kind:'operator-snapshot',url,operator:snapshot.operator,
    legitimatelyCaptured:true,sha256:snapshot.sha256,digestBasis:'decoded-html-utf8',capturedAt:snapshot.capturedAt}};
}

export async function recoverPublicDiscovery(id:string,options:{attemptId:string;authorizeRetry?:boolean;snapshot?:string;baseDirectory?:string;read?:typeof readPublicPage}) {
  if(!/^[a-f0-9]{20}$/.test(id)||! /^[a-zA-Z0-9_-]{1,80}$/.test(options.attemptId))throw Error('PUBLIC_RECOVERY_ARGUMENT_INVALID');
  if((options.authorizeRetry===true)===Boolean(options.snapshot))throw Error('PUBLIC_RECOVERY_SELECT_AUTHORIZED_RETRY_OR_SNAPSHOT');
  const base=resolve(options.baseDirectory??publicMigrationRoot),directory=join(base,id),lock=join(base,id+'.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw Error('PUBLIC_MIGRATION_JOB_LOCKED');});
  try {
    const stat=await lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('PUBLIC_MIGRATION_JOB_INVALID');
    const manifest=await json(join(directory,'manifest.json'));
    if(manifest.jobId!==id||sha(validatePublicDiscoveryUrl(manifest.url)).slice(0,20)!==id)throw Error('PUBLIC_MIGRATION_JOB_CONFLICT');
    const current=await json(join(directory,'status.json'));
    if(current.summary.dispatched!==0||current.authorization.granted||current.tasks.some((t:any)=>t.dispatch.delivered||t.dispatch.state!=='not-dispatched'))throw Error('PUBLIC_RECOVERY_DOWNSTREAM_STATE_CHANGED');
    const history=join(directory,'discovery-history');await mkdir(history,{recursive:true,mode:0o700});
    // Preserve original artifacts before any recovery writes, including the initial failure.
    try {await lstat(join(history,'original.json'));} catch(e) {
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      await save(join(history,'original.json'),{manifest,status:await json(join(directory,'status.json')),checkpoint:await json(join(directory,'checkpoint.json')),plan:await json(join(directory,'plan.json'))});
    }
    const apply=async(record:any)=>{
      const {integrity,...payload}=record;
      if(integrity!==sha(JSON.stringify(payload)) || record.evidence && (typeof record.html!=='string'||sha(record.html)!==record.evidence.sourceDigest))throw Error('PUBLIC_RECOVERY_HISTORY_INTEGRITY_FAILED');
      if(record.evidence)await save(join(directory,'source.html'),record.html,true);
      if(record.evidence)await save(join(directory,'evidence.json'),record.evidence);
      await save(join(directory,'plan.json'),record.plan);
      await save(join(directory,'checkpoint.json'),record.checkpoint);
      await save(join(directory,'status.json'),record.status);
    };
    // A committed outcome can be replayed after interruption without another network request.
    const records=(await readdir(history)).filter(n=>/^\d{6}-.*\.json$/.test(n)).sort();
    if(records.length)await apply(await json(join(history,records.at(-1)!)));
    for(const file of records)if((await json(join(history,file))).attemptId===options.attemptId)return json(join(directory,'status.json'));
    const status=await json(join(directory,'status.json'));
    if(status.sourceDiscovery==='completed')return status;
    const checkpoint=await json(join(directory,'checkpoint.json')),plan=await json(join(directory,'plan.json'));
    const started=join(history,options.attemptId+'.started.json');
    // A started attempt without an outcome is uncertain: require a NEW explicit attempt ID.
    const startedHandle=await open(started,'wx',0o600).catch(()=>{throw Error('PUBLIC_RECOVERY_ATTEMPT_INCOMPLETE_USE_NEW_ID');});
    await startedHandle.writeFile(JSON.stringify({attemptId:options.attemptId,at:new Date().toISOString(),mode:options.snapshot?'operator-snapshot':'authorized-network-retry'}));await startedHandle.close();
    let evidence:any,diagnostic:unknown,sourceHtml:string|undefined;
    try {
      const captured=options.snapshot?await validatePublicSnapshot(options.snapshot,manifest.url):await (options.read??readPublicPage)(manifest.url);
      const discovery=inspectPublicHtml(captured.html,manifest.url);sourceHtml=captured.html;
      evidence={version:1,jobId:id,...discovery,capturedAt:captured.capturedAt,sourceHtmlPersisted:true,sourceHtml:join(directory,'source.html'),
        provenance:'provenance' in captured?captured.provenance:{kind:'authorized-network-retry',url:manifest.url,capturedAt:captured.capturedAt,sha256:discovery.sourceDigest,digestBasis:discovery.digestBasis}};
      status.sourceDiscovery='completed';status.state='prepared-blocked';delete status.reason;
      status.evidence=join(directory,'evidence.json');status.summary.completed=1;
      for(const task of status.tasks)task.blockers=task.blockers.filter((b:string)=>b!=='PUBLIC_SOURCE_DISCOVERY_REQUIRED');
      plan.tasks=status.tasks;
      checkpoint.completed=[...new Set([...checkpoint.completed,'public-source-discovery','plan-and-routing'])];
      checkpoint.outputs={...checkpoint.outputs,publicSourceDigest:discovery.sourceDigest};
    } catch(e) {
      status.reason=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PUBLIC_SOURCE_DISCOVERY_FAILED';
      diagnostic=(e as {diagnostic?:unknown})?.diagnostic;
    }
    checkpoint.state=status.state;checkpoint.updatedAt=new Date().toISOString();
    const payload=JSON.parse(JSON.stringify({html:sourceHtml,attemptId:options.attemptId,at:checkpoint.updatedAt,diagnostic,evidence,status,checkpoint,plan}));
    const record={...payload,integrity:sha(JSON.stringify(payload))};
    await save(join(history,String(records.length+1).padStart(6,'0')+'-'+options.attemptId+'.json'),record);
    await apply(record);
    return status;
  } finally {await handle.close();await rm(lock,{force:true});}
}
