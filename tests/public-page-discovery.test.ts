import test from 'node:test';
import assert from 'node:assert/strict';
import { atendimentoUrl, publicIPv4, assertPublicResponse, inspectPublicHtml, validatePublicDiscoveryUrl } from '../src/integrations/public-page-discovery.js';
import { preparePublicMigrationJob } from '../src/autopilot/public-migration-job.js';
import { runMaestroUrl } from '../src/cli-maestro-url.js';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const html=`<!doctype html><html><head><title>Atendimento</title></head><body><nav><a href="/ouvidoria">Ouvidoria</a><a href="https://evil.example/?token=x">Seguro</a></nav><h1>Atendimento</h1><p>Fale com a BIA no WhatsApp.</p><h2>Perguntas frequentes</h2><h2>Cartões</h2><h2>Investimentos</h2><h2>Consórcios</h2><h2>Fone Fácil</h2><h2>Bradescard</h2><h2>Renegociação de Dívidas</h2><form><label>CPF</label><input value="must-not-appear"></form><script>secret()</script></body></html>`;

test('public discovery accepts only selected URL and rejects unsafe response classes',()=>{
 assert.equal(validatePublicDiscoveryUrl(atendimentoUrl),atendimentoUrl);
 for(const url of ['http://banco.bradesco/html/classic/atendimento/atendimento.shtm','https://evil.example/a',atendimentoUrl+'?x=1'])assert.throws(()=>validatePublicDiscoveryUrl(url));
 assert.equal(publicIPv4('8.8.8.8'),true);for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.2.1','100.64.0.1'])assert.equal(publicIPv4(ip),false);
 assert.doesNotThrow(()=>assertPublicResponse(200,'text/html; charset=utf-8'));
 assert.throws(()=>assertPublicResponse(302,'text/html','identity'));assert.throws(()=>assertPublicResponse(200,'application/json','identity'));assert.throws(()=>assertPublicResponse(200,'text/html','gzip'));
});
test('static parser finds candidate sections and sensitive flows without retaining form values',()=>{
 const result=inspectPublicHtml(html);
 assert.equal(result.title,'Atendimento');assert.equal(result.faq.observedCategories.length,6);
 assert.ok(result.candidates.find(c=>c.sourceId==='bia-content')?.observed);
 assert.ok(result.candidates.find(c=>c.sourceId==='faq')?.observed);
 assert.ok(result.sensitive.find(s=>s.kind==='personal-data-form')?.observed);
 assert.ok(result.sensitive.every(s=>s.operationExecuted===false));
 assert.ok(result.links.every(l=>!l.url.includes('token')));
 assert.doesNotMatch(JSON.stringify(result),/must-not-appear|secret\(\)/);
 assert.ok(result.candidates.every(c=>c.resourceType===null&&c.reuseVerified===false));
});
async function fixture(){const base=await mkdtemp(join(tmpdir(),'public-job-'));const read=async()=>({html,capturedAt:'2026-11-19T12:00:00.000Z'});return {base,read,cleanup:()=>rm(base,{recursive:true,force:true})};}
test('single URL CLI prepares a traceable workspace, plan, checkpoints and source evidence without dispatch',async()=>{
 const f=await fixture();try{
  const out:any=await runMaestroUrl(['migrate',atendimentoUrl],{prepare:(url)=>preparePublicMigrationJob(url,{baseDirectory:f.base,read:f.read})});
  assert.equal(out.sourceDiscovery,'completed');assert.equal(out.summary.completed,1);assert.equal(out.summary.dispatched,0);
  assert.ok(out.tasks.some((t:any)=>t.agentCandidate==='Analytics'));assert.ok(out.tasks.some((t:any)=>t.agentCandidate==='UE-Pattern'));assert.ok(out.tasks.some((t:any)=>t.agentCandidate==='Hermes'));
  assert.ok(out.tasks.every((t:any)=>t.status==='blocked'&&t.dispatch.delivered===false));
  for(const path of [out.manifest,out.checkpoint,out.evidence,join(f.base,out.jobId,'plan.json'),out.workspace])assert.ok((await stat(path)).isDirectory()||path.endsWith('.json')||path.endsWith('evidence.json'));
  const manifest=JSON.parse(await readFile(out.manifest,'utf8'));assert.equal(manifest.taskDelivery.dispatchCount,0);assert.equal(manifest.sourcePolicy.aemWrites,false);
  assert.equal(JSON.parse(await readFile(out.evidence,'utf8')).sourceHtmlPersisted,false);
 }finally{await f.cleanup();}
});
test('same URL is idempotent and does not refetch or duplicate job files',async()=>{
 const f=await fixture();try{
  let fetches=0;const read=async()=>{fetches++;return f.read();};
  const first=await preparePublicMigrationJob(atendimentoUrl,{baseDirectory:f.base,read});
  const second=await preparePublicMigrationJob(atendimentoUrl,{baseDirectory:f.base,read});
  assert.equal(first.jobId,second.jobId);assert.equal(fetches,1);
  assert.deepEqual((await readdir(join(f.base,first.jobId))).sort(),['checkpoint.json','evidence.json','manifest.json','plan.json','status.json','workspace'].sort());
 }finally{await f.cleanup();}
});
test('source failure still records blocked job and exact failure; malformed CLI has no side effects',async()=>{
 const f=await fixture();try{
  const failed=await preparePublicMigrationJob(atendimentoUrl,{baseDirectory:f.base,read:async()=>{throw Error('PUBLIC_SOURCE_NETWORK_PERMISSION_DENIED');}});
  assert.equal(failed.state,'blocked');assert.equal(failed.reason,'PUBLIC_SOURCE_NETWORK_PERMISSION_DENIED');assert.equal(failed.summary.dispatched,0);
  await assert.rejects(runMaestroUrl(['migrate',atendimentoUrl,'--autopilot'],{prepare:async()=>{throw Error('MUST_NOT_CALL');}}),/USAGE/);
 }finally{await f.cleanup();}
});
