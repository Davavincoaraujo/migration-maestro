import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { analyzeUrlViaMcp, validatePageUrl } from "./integrations/url-analysis-orchestrator.js";
const host = "127.0.0.1";
const port = 4178;
type Run = { id: string; status: string; stage: string; error?: string; resultBlocks?: number; tool?: string | null };
const runs = new Map<string, Run>();
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migration Maestro</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#e8eefb;background:#080f20}*{box-sizing:border-box}body{margin:0}main{max-width:920px;margin:64px auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:42px;letter-spacing:-2px;margin:28px 0 12px}p{color:#9eacc7;line-height:1.6}.panel{background:#111d34;border:1px solid #273854;border-radius:18px;padding:28px;margin:26px 0}label{display:block;margin-bottom:12px;font-weight:600}input{width:100%;padding:16px;border-radius:10px;border:1px solid #435573;background:#0a1427;color:white;font-size:16px}button{margin-top:16px;padding:14px 22px;background:#628dff;color:#06122d;border:0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.step{background:#0b162b;border:1px solid #253957;border-radius:12px;padding:16px}.muted{color:#a9b7d0;font-size:13px}.state{font-weight:700;color:#9ec0ff}#error{color:#ffb1b1;overflow-wrap:anywhere}@media(max-width:650px){main{margin:12px auto}h1{font-size:30px}.steps{grid-template-columns:1fr}}
</style></head><body><main><header><strong>◈ Migration Maestro</strong><span class="muted">Local · Preview</span></header><h1>Migração de páginas, orquestrada.</h1><p>Informe a URL da página legada. O Maestro aciona o Migration Analyst e acompanha a execução. Implementação e publicação continuam exigindo revisão.</p><section class="panel"><form id="form"><label for="url">URL da página legada</label><input id="url" type="url" placeholder="https://exemplo.com/pagina" required><button id="submit" type="submit">Iniciar análise</button></form><p id="error" role="alert"></p></section><section class="panel"><h2>Progresso da migração</h2><div class="steps"><div class="step"><strong>01 · Análise</strong><p id="analysis" class="state">Aguardando</p></div><div class="step"><strong>02 · Planejamento</strong><p class="state">Pendente</p></div><div class="step"><strong>03 · Implementação</strong><p class="state">Aprovação necessária</p></div></div><p class="muted" id="detail">Nenhuma execução iniciada.</p></section></main><script>
const form=document.getElementById("form"),button=document.getElementById("submit"),error=document.getElementById("error"),analysis=document.getElementById("analysis"),detail=document.getElementById("detail");
form.addEventListener("submit",async e=>{e.preventDefault();button.disabled=true;error.textContent="";analysis.textContent="Iniciando";try{const res=await fetch("/api/runs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:document.getElementById("url").value})});const data=await res.json();if(!res.ok)throw Error(data.error||"Falha");detail.textContent="Execução "+data.id;const poll=async()=>{const r=await fetch("/api/runs/"+encodeURIComponent(data.id));const run=await r.json();analysis.textContent=run.status;detail.textContent=run.stage+(run.tool?" · "+run.tool:"");if(run.error)error.textContent=run.error;if(run.status==="running")setTimeout(poll,1000);else button.disabled=false};poll()}catch(err){error.textContent=err.message;button.disabled=false}});
</script></body></html>`;
const server = createServer(async (req,res) => {
 const send=(status:number,value:unknown)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(value));};
 if(req.method==="GET"&&req.url==="/"){res.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'","cache-control":"no-store"});res.end(html);return;}
 if(req.method==="GET"&&req.url?.startsWith("/api/runs/")){const run=runs.get(req.url.slice(10));return run?send(200,run):send(404,{error:"RUN_NOT_FOUND"});}
 if(req.method==="POST"&&req.url==="/api/runs"){
  if(req.headers.origin && req.headers.origin!==`http://${host}:${port}`)return send(403,{error:"ORIGIN_DENIED"});
  if([...runs.values()].some(r=>r.status==="running"))return send(409,{error:"RUN_ALREADY_ACTIVE"});
  let raw="";for await(const chunk of req){raw+=String(chunk);if(raw.length>4096)return send(413,{error:"REQUEST_TOO_LARGE"});}
  let url:string;try{url=validatePageUrl(JSON.parse(raw).url)}catch{return send(400,{error:"INVALID_PAGE_URL"});}
  const id=randomUUID(),run:Run={id,status:"running",stage:"migration_analyst"};runs.set(id,run);send(202,{id});
  void analyzeUrlViaMcp(process.env.MAESTRO_ANALYTICS_DIR,url).then(result=>{run.status=result.stage==="analyzed"?"review_required":"blocked";run.stage=result.stage==="analyzed"?"plan_tasks":"migration_analyst";run.tool=result.tool;run.resultBlocks=result.content.length;if(result.reason)run.error=result.reason;}).catch(e=>{run.status="failed";run.error=/^[A-Z_]+$/.test(e?.message??"")?e.message:"ANALYSIS_FAILED";});
  return;
 }
 send(404,{error:"NOT_FOUND"});
});
server.listen(port,host,()=>process.stdout.write(`Migration Maestro: http://${host}:${port}\n`));
