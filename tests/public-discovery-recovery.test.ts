import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { preparePublicMigrationJob } from '../src/autopilot/public-migration-job.js';
import { recoverPublicDiscovery } from '../src/autopilot/public-discovery-recovery.js';
import { atendimentoUrl, classifyPublicSourceError } from '../src/integrations/public-page-discovery.js';
const html='<html><body><h1>Atendimento</h1></body></html>';
const capturedAt='2026-01-01T00:00:00.000Z';
async function fixture() {
 const baseDirectory=await mkdtemp(join(tmpdir(),'recovery-'));
 const status=await preparePublicMigrationJob(atendimentoUrl,{baseDirectory,read:async()=>{throw Error('PUBLIC_SOURCE_DNS_UNAVAILABLE');}});
 return {baseDirectory,status,dir:join(baseDirectory,status.jobId),cleanup:()=>rm(baseDirectory,{recursive:true,force:true})};
}
test('transport classification separates DNS, permission, timeout, TLS and network',()=>{
 for(const [code,expected] of Object.entries({ENOTFOUND:'DNS_UNAVAILABLE',EAI_AGAIN:'DNS_UNAVAILABLE',EPERM:'NETWORK_PERMISSION_DENIED',EACCES:'NETWORK_PERMISSION_DENIED',ETIMEDOUT:'TIMEOUT',CERT_HAS_EXPIRED:'TLS_ERROR',ECONNRESET:'NETWORK_UNAVAILABLE'}))
 assert.equal(classifyPublicSourceError(Object.assign(Error(),{code})).message,'PUBLIC_SOURCE_'+expected);
});
test('authorized recovery retains original failure and manifest; replay repairs partial updates without fetching',async()=>{
 const f=await fixture();try {
 const manifest=await readFile(join(f.dir,'manifest.json'),'utf8');let calls=0;
 const options={baseDirectory:f.baseDirectory,attemptId:'retry-1',authorizeRetry:true,read:async()=>{calls++;return {html,capturedAt};}};
 await assert.rejects(recoverPublicDiscovery(f.status.jobId,{...options,authorizeRetry:false}),/SELECT_AUTHORIZED/);
 const result=await recoverPublicDiscovery(f.status.jobId,options);
 assert.equal(result.sourceDiscovery,'completed');assert.equal(result.summary.dispatched,0);
 assert.ok(result.tasks.every((t:any)=>t.dispatch.delivered===false&&t.blockers.includes('TASK_NOT_DISPATCHED')&&!t.blockers.includes('PUBLIC_SOURCE_DISCOVERY_REQUIRED')));
 assert.equal(await readFile(join(f.dir,'manifest.json'),'utf8'),manifest);
 const original=JSON.parse(await readFile(join(f.dir,'discovery-history/original.json'),'utf8'));
 assert.equal(original.status.reason,'PUBLIC_SOURCE_DNS_UNAVAILABLE');
 await writeFile(join(f.dir,'status.json'),JSON.stringify(f.status));
 assert.equal((await recoverPublicDiscovery(f.status.jobId,options)).sourceDiscovery,'completed');assert.equal(calls,1);
 const checkpoint=JSON.parse(await readFile(join(f.dir,'checkpoint.json'),'utf8'));
 assert.equal(checkpoint.completed.filter((s:string)=>s==='public-source-discovery').length,1);
 }finally{await f.cleanup();}
});
test('snapshot hash, origin, attestation and date are validated; failed attempts remain and never fetch',async()=>{
 const f=await fixture();try {
 const path=join(f.baseDirectory,'snapshot.json');
 const snapshot={version:1,url:atendimentoUrl,operator:'operator',capturedAt,legitimatelyCaptured:true,html,sha256:createHash('sha256').update(html).digest('hex')};
 let attempt=0;
 for(const invalid of [{sha256:'bad'},{url:'https://example.com'},{capturedAt:'2099-01-01T00:00:00Z'},{legitimatelyCaptured:false},{html:'invalid'}]) {
 await writeFile(path,JSON.stringify({...snapshot,...invalid}));
 const result=await recoverPublicDiscovery(f.status.jobId,{baseDirectory:f.baseDirectory,attemptId:'snapshot-'+(++attempt),snapshot:path,read:async()=>{throw Error('MUST_NOT_FETCH');}});
 assert.equal(result.sourceDiscovery,'blocked');assert.equal(result.reason,'PUBLIC_SNAPSHOT_INVALID');
 }
 await writeFile(path,JSON.stringify(snapshot));
 const result=await recoverPublicDiscovery(f.status.jobId,{baseDirectory:f.baseDirectory,attemptId:'valid',snapshot:path});
 assert.equal(result.sourceDiscovery,'completed');
 const evidence=JSON.parse(await readFile(result.evidence,'utf8'));
 assert.equal(evidence.provenance.sha256,snapshot.sha256);assert.equal(evidence.provenance.operator,'operator');
 assert.equal((await readdir(join(f.dir,'discovery-history'))).filter(n=>/^\d{6}-/.test(n)).length,6);
 }finally{await f.cleanup();}
});
test('failed retry is idempotent and a new ID permits another explicitly authorized attempt',async()=>{
 const f=await fixture();try {let calls=0;
 const options={baseDirectory:f.baseDirectory,attemptId:'timeout',authorizeRetry:true,read:async()=>{calls++;throw Error('PUBLIC_SOURCE_TIMEOUT');}};
 assert.equal((await recoverPublicDiscovery(f.status.jobId,options)).reason,'PUBLIC_SOURCE_TIMEOUT');
 await recoverPublicDiscovery(f.status.jobId,options);assert.equal(calls,1);
 await recoverPublicDiscovery(f.status.jobId,{...options,attemptId:'timeout-2'});assert.equal(calls,2);
 }finally{await f.cleanup();}
});
test('persisted HTML matches SHA-256; tampered journal fails closed',async()=>{
 const f=await fixture();try {
 const options={baseDirectory:f.baseDirectory,attemptId:'capture',authorizeRetry:true,read:async()=>({html,capturedAt})};
 const result=await recoverPublicDiscovery(f.status.jobId,options);
 assert.equal(await readFile(join(f.dir,'source.html'),'utf8'),html);
 const checkpoint=JSON.parse(await readFile(join(f.dir,'checkpoint.json'),'utf8'));
 assert.equal(checkpoint.outputs.publicSourceDigest,createHash('sha256').update(html).digest('hex'));
 assert.equal(result.tasks.find((t:any)=>t.stage==='ANALYZE').status,'blocked');
 const journal=join(f.dir,'discovery-history/000001-capture.json');
 const record=JSON.parse(await readFile(journal,'utf8'));record.html+='tampered';await writeFile(journal,JSON.stringify(record));
 await assert.rejects(recoverPublicDiscovery(f.status.jobId,options),/INTEGRITY_FAILED/);
 }finally{await f.cleanup();}
});
test('uncertain attempt requires a new ID and concurrent lock prevents reads',async()=>{
 const f=await fixture();try {
 const options={baseDirectory:f.baseDirectory,attemptId:'uncertain',authorizeRetry:true,read:async()=>{throw Error('PUBLIC_SOURCE_TIMEOUT');}};
 await recoverPublicDiscovery(f.status.jobId,options);
 await rm(join(f.dir,'discovery-history/000001-uncertain.json'));
 await assert.rejects(recoverPublicDiscovery(f.status.jobId,options),/ATTEMPT_INCOMPLETE/);
 await writeFile(join(f.baseDirectory,f.status.jobId+'.lock'),'');
 await assert.rejects(recoverPublicDiscovery(f.status.jobId,{...options,attemptId:'new'}),/JOB_LOCKED/);
 }finally{await f.cleanup();}
});
test('native fetch dispatcher captures HTML without network and rejects HTTP redirects',async()=>{
 const https=await import('node:https');
 const {syncBuiltinESMExports}=await import('node:module');
 const {EventEmitter}=await import('node:events');
 const {PassThrough}=await import('node:stream');
 const {readPublicPage}=await import('../src/integrations/public-page-discovery.js');
 const original=https.default.get;
 let status=200;
 try {
 https.default.get=((url:any,options:any,callback:any)=>{
   assert.equal(url,atendimentoUrl);assert.equal(options.agent,false);assert.equal(typeof options.lookup,'function');
   const request=new EventEmitter() as any;request.destroy=()=>request;
   queueMicrotask(()=>{
     const response=new PassThrough() as any;
     response.statusCode=status;response.statusMessage='OK';response.headers={'content-type':'text/html; charset=utf-8'};
     response.rawHeaders=['Content-Type','text/html; charset=utf-8'];
     callback(response);if(!response.destroyed)response.end(html);
   });
   return request;
 }) as typeof https.default.get;
 syncBuiltinESMExports();
 assert.equal((await readPublicPage(atendimentoUrl)).html,html);
 status=302;await assert.rejects(readPublicPage(atendimentoUrl),/REDIRECT_REQUIRES_REVIEW/);
 }finally{https.default.get=original;syncBuiltinESMExports();}
});
