import { createServer, type Server } from "node:http";
import { runAgentPlanning, type Plan } from "./maestro-agent-planning.js";

type State = "idle" | "running" | "completed" | "blocked";
export type ViewState = { state: State; analytics: string; uePattern: string; hermes: string; plan?: Plan };
const safe = (value: string) => value.replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]!);
export function renderOrchestrationView(data: ViewState): string {
  const nodes = [
    ["Migration Analytics", data.analytics],
    ["UE-Pattern", data.uePattern],
    ["Hermes ACP", data.hermes],
    ["Revisão humana", data.state === "completed" ? "required" : "waiting"]
  ];
  const shapes = nodes.map(([name,status],i) => {
    const x=24+i*225;
    const fill=status==="completed"?"#134e4a":status==="failed"?"#7f1d1d":"#1e293b";
    return `<g><rect x="${x}" y="36" width="194" height="94" rx="12" fill="${fill}" stroke="#64748b"/><text x="${x+97}" y="70" text-anchor="middle" fill="#fff" font-size="15">${safe(name)}</text><text x="${x+97}" y="96" text-anchor="middle" fill="#cbd5e1" font-size="12">${safe(status)}</text></g>`;
  }).join("");
  const arrows=[0,1,2].map(i=>`<path d="M${218+i*225} 83 H${249+i*225}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)"/>`).join("");
  const steps=(data.plan?.steps??[]).map(s=>`<li><strong>${safe(s.id)}</strong>: ${safe(s.description)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'"><title>Migration Maestro — Orquestração</title><style>body{font:16px system-ui;background:#0f172a;color:#f8fafc;max-width:1050px;margin:40px auto;padding:16px}h1{font-size:26px}p{color:#cbd5e1}svg{width:100%;height:auto}section{background:#1e293b;padding:20px;border-radius:12px;margin-top:20px}li{margin:12px 0}code{color:#5eead4}</style></head><body><h1>Migration Maestro · Orquestração local</h1><p>Estado: <strong>${safe(data.state)}</strong> · Somente leitura · Sem deploy ou merge automático</p><svg role="img" aria-label="Fluxo Analytics, UE-Pattern, Hermes e revisão" viewBox="0 0 930 160"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#94a3b8"/></marker></defs>${arrows}${shapes}</svg><section><h2>Plano gerado</h2>${data.plan?`<ol>${steps}</ol>`:"<p>Aguardando execução ou integração indisponível.</p>"}<p>Execução autorizada: <code>não</code> · Revisão humana: <code>obrigatória</code></p></section><p>Esta visualização é hospedada pelo Maestro no seu Mac. Não é uma extensão nativa do Maestri.app.</p></body></html>`;
}
export async function startOrchestrationView(query: string, port = 4188, planRunner: typeof runAgentPlanning = runAgentPlanning): Promise<Server> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("INVALID_PORT");
  if (!/^[a-zA-Z0-9 _-]{1,80}$/.test(query) || !query.trim()) throw Error("INVALID_QUERY");
  let state: ViewState = { state: "running", analytics: "waiting", uePattern: "waiting", hermes: "waiting" };
  const server = createServer((req,res) => {
    if (req.method !== "GET" || req.url !== "/") {res.writeHead(404);res.end();return;}
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer"});
    res.end(renderOrchestrationView(state));
  });
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  void Promise.resolve().then(()=>planRunner(query)).then(result=>{
    state={state:result.plan?"completed":"blocked",analytics:result.analytics,uePattern:result.uePattern,hermes:result.hermes,...(result.plan?{plan:result.plan}:{})};
  }).catch(()=>{state={state:"blocked",analytics:"failed",uePattern:"failed",hermes:"failed"};});
  return server;
}
