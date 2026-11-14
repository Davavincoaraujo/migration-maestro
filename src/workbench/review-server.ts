import { AgentHistoryStore } from "./agent-history.js";
import { renderAgentInspector } from "./agent-inspector.js";
import { renderDiagramsPage, type DiagramKind } from "./migration-diagrams.js";
import { renderAgentGraph, type AgentVisualState } from "./agent-graph-html.js";
import { createSyntheticAgentHandlers, executeLocalAgentGraph } from "../orchestration/local-agent-executor.js";
import { FileCheckpointStore } from "../autopilot/file-checkpoint-store.js";
import { MaestroEventJournal } from "../integrations/event-journal.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, rename } from "node:fs/promises";
import { runLocalWorkbench } from "./local-workbench.js";
import type { EvidenceBatchJob } from "../pipeline/evidence-batch.js";
import { resolve, join } from "node:path";
import { readReviewLedger, recordReview, reviewDigest, type ReviewLedger } from "./review-ledger.js";
import type { WorkbenchReport } from "./local-workbench.js";

const htmlEscape = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const validId = (s: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(s);
const maxBody = 4096;
function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function renderReviewDashboard(report: WorkbenchReport, ledger: ReviewLedger, csrf: string, notice = "", canRun = false): string {
  const rows = report.jobs.map(job => {
    const decision = ledger.entries.find(e => e.jobId === job.id);
    const status = decision ? decision.decision + " by " + decision.reviewer : job.status;
    const detailLink = `<a href="/job?id=${encodeURIComponent(job.id)}">Detalhes</a>`;
    let form = "";
    if (job.status === "review-required" && !decision && !job.findings.length) {
      const digest = reviewDigest(report, job.id);
      form = `<form method="post" action="/review"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="jobId" value="${htmlEscape(job.id)}"><input type="hidden" name="digest" value="${digest}"><label>Revisor <input name="reviewer" required maxlength="80" pattern="[A-Za-z0-9_-]{1,80}" autocomplete="off"></label><button name="decision" value="approved">Aprovar plano</button><button name="decision" value="rejected">Rejeitar</button></form>`;
    }
    return `<tr><td>${htmlEscape(job.id)}</td><td>${htmlEscape(status)}</td><td>${job.componentCount}</td><td>${htmlEscape(job.findings.join(", ") || "Nenhuma")}</td><td>${form || "Somente leitura"}</td><td>${detailLink}</td></tr>`;
  }).join("");
  const history = ledger.entries.map(e => `<li>${htmlEscape(e.jobId)} — ${htmlEscape(e.decision)} por ${htmlEscape(e.reviewer)} em ${htmlEscape(e.decidedAt)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Migration Maestro — Revisão local</title><style>body{font:16px system-ui,sans-serif;max-width:1150px;margin:3rem auto;padding:0 1rem;color:#152432}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:12px;text-align:left;vertical-align:top}th{background:#eef2f6}form{display:flex;gap:8px;flex-wrap:wrap}button,input{padding:8px}button{cursor:pointer}aside{padding:12px;background:#f4f6f9}small{color:#526273}</style></head><body><h1>Migration Maestro</h1><aside>Revisão humana local de planos sintéticos. Aprovar não publica no AEM e não concede permissão de escrita.</aside>${notice ? `<p role="status">${htmlEscape(notice)}</p>` : ""}${canRun ? `<form method="post" action="/run"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Executar lote sintético</button></form>` : ""}<h2>Jobs (${report.summary.total})</h2><table><thead><tr><th>Job</th><th>Status</th><th>Componentes</th><th>Pendências</th><th>Decisão</th><th>Inspeção</th></tr></thead><tbody>${rows}</tbody></table><h2>Histórico</h2><ul>${history || "<li>Nenhuma decisão registrada</li>"}</ul><small>Etapas executadas: ${report.metrics.stageExecutions}; checkpoints reutilizados: ${report.metrics.reusedCheckpoints}. Servidor restrito ao loopback, sem integrações corporativas.</small></body></html>`;
}
/** Read-only inspector uses only sanitized report fields, never raw source content. */
export function renderJobInspector(report: WorkbenchReport, ledger: ReviewLedger, id: string): string {
  const job = report.jobs.find(item => item.id === id);
  if (!job) throw new Error("Unknown job");
  const entry = ledger.entries.find(item => item.jobId === id);
  const stages = job.stages.map((stage, index) => `<li>Etapa ${index + 1}: ${htmlEscape(stage)} — concluída</li>`).join("");
  const findings = job.findings.map(finding => `<li>${htmlEscape(finding)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Job ${htmlEscape(id)} — Migration Maestro</title><style>body{font:16px system-ui,sans-serif;max-width:800px;margin:3rem auto;padding:0 1rem;color:#152432}li{padding:6px}aside{padding:12px;background:#eef2f6}a{color:#1457a5}</style></head><body><p><a href="/">← Voltar ao dashboard</a></p><h1>Job ${htmlEscape(id)}</h1><aside>Status: ${htmlEscape(job.status)} · Componentes: ${job.componentCount} · Revisão: ${entry ? htmlEscape(entry.decision + " por " + entry.reviewer) : "pendente"}</aside><h2>Etapas concluídas</h2><ol>${stages || "<li>Nenhuma etapa concluída</li>"}</ol><h2>Pendências</h2><ul>${findings || "<li>Nenhuma</li>"}</ul><p>Este painel é somente leitura. Nenhuma escrita ou publicação no AEM.</p><small>Atualização automática a cada 10 segundos.</small></body></html>`;
}
function respond(res: ServerResponse, code: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(body);
}
async function bodyText(req: IncomingMessage): Promise<string> {
  let value = "";
  for await (const chunk of req) {
    value += String(chunk);
    if (value.length > maxBody) throw new Error("Request too large");
  }
  return value;
}
/** Loopback-only interactive review server. One process per ledger; no remote access. */
export async function startReviewServer(directory: string, port = 4177, syntheticInputFile?: string) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const base = resolve(directory);
  const ledgerPath = join(base, "reviews.json");
  const csrf = randomBytes(32).toString("hex");
  let busy = false;
  let running = false;
  type JobProgress = { id: string; status: "queued" | "running" | "review-required" | "blocked" | "failed" | "cancelled"; stage: string; completed: number; total: number };
  let jobProgress: JobProgress[] = [];
  const journal = new MaestroEventJournal();
  const agentHistory = new AgentHistoryStore(base);
  let agentRun: { status: "idle" | "running" | "completed" | "failed"; jobId?: string } = { status: "idle" };
  let agentStates: AgentVisualState[] = [];
  let runState: { status: "idle" | "running" | "completed" | "failed"; startedAt?: string; finishedAt?: string } = { status: "idle" };
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) {
      respond(res, 403, "Forbidden", "text/plain; charset=utf-8"); return;
    }
    const requestUrl = new URL(req.url ?? "/", origin);
    if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/review" && requestUrl.pathname !== "/job" && requestUrl.pathname !== "/run" && requestUrl.pathname !== "/run-status" && requestUrl.pathname !== "/events" && requestUrl.pathname !== "/agents" && requestUrl.pathname !== "/agents/run" && requestUrl.pathname !== "/agents/status" && requestUrl.pathname !== "/diagrams" && requestUrl.pathname !== "/agents/inspect" && requestUrl.pathname !== "/agents/history" && requestUrl.pathname !== "/agents/history/view") { respond(res, 404, "Not found", "text/plain; charset=utf-8"); return; }
    if (req.method !== "GET" && req.method !== "POST") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
    try {
      if (req.method === "POST") {
        // Browser form navigations can omit Origin/Fetch Metadata in embedded webviews.
        // An explicit foreign Origin or cross-site Fetch Metadata is always rejected.
        const requestOrigin = req.headers.origin;
        const fetchSite = req.headers["sec-fetch-site"];
        if ((requestUrl.pathname !== "/review" && requestUrl.pathname !== "/run" && requestUrl.pathname !== "/agents/run") ||
            (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== "null") ||
            (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none")) {
          respond(res, 403, "Forbidden: request origin", "text/plain; charset=utf-8"); return;
        }
        if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
          respond(res, 415, "Unsupported form content type", "text/plain; charset=utf-8"); return;
        }
        if (requestUrl.pathname === "/agents/run") {
          if (!syntheticInputFile) { respond(res, 403, "Synthetic runner not configured", "text/plain; charset=utf-8"); return; }
          if (running || busy || agentRun.status === "running") { respond(res, 409, "Runner busy", "text/plain; charset=utf-8"); return; }
          const params = new URLSearchParams(await bodyText(req));
          const jobId = params.get("jobId") ?? "";
          if (params.size !== 2 || params.getAll("csrf").length !== 1 ||
              params.getAll("jobId").length !== 1 || !secureEqual(params.get("csrf") ?? "", csrf) ||
              !validId(jobId)) { respond(res, 403, "Invalid agent run request", "text/plain; charset=utf-8"); return; }
          const raw: unknown = JSON.parse(await readFile(resolve(syntheticInputFile), "utf8"));
          if (!Array.isArray(raw) || raw.length > 100 || !raw.some(item => item && typeof item === "object" && item.id === jobId)) {
            respond(res, 400, "Unknown synthetic job", "text/plain; charset=utf-8"); return;
          }
          agentRun = { status: "running", jobId };
          agentStates = [];
          void (async () => {
            const started = Date.now();
            let previous = started;
            const historyWrites: Promise<unknown>[] = [];
            try {
              await agentHistory.append({ jobId, kind: "run.started" });
              const fixture = (raw as EvidenceBatchJob[]).find(item => item.id === jobId);
              if (!fixture) throw new Error("Missing job");
              const store = new FileCheckpointStore(join(base, "agent-checkpoints"));
              await executeLocalAgentGraph(jobId, fixture.input, createSyntheticAgentHandlers(), store, undefined, event => {
                const now = Date.now();
                historyWrites.push(agentHistory.append({ jobId, kind: event.stage === "checkpoint-reused" ? "agent.reused" : "agent.completed", agentId: event.agentId === "none" ? undefined : event.agentId, elapsedMs: now - previous }));
                previous = now;
                if (event.stage === "checkpoint-reused") {
                  agentStates = ["discovery", "evidence", "mapping", "composition", "quality"].map(id => ({ id, status: "reused" as const }));
                } else {
                  agentStates = [...agentStates.filter(item => item.id !== event.agentId), { id: event.agentId, status: "completed" }];
                }
              });
              await Promise.all(historyWrites);
              await agentHistory.append({ jobId, kind: "run.completed", elapsedMs: Date.now() - started });
              agentRun = { status: "completed", jobId };
            } catch {
              await Promise.allSettled(historyWrites);
              try { await agentHistory.append({ jobId, kind: "run.failed", elapsedMs: Date.now() - started }); } catch { /* no sensitive error details */ }
              agentRun = { status: "failed", jobId };
            }
          })();
          res.writeHead(303, { Location: "/agents", "Cache-Control": "no-store" });
          res.end(); return;
        }
        if (requestUrl.pathname === "/run") {
          if (!syntheticInputFile) { respond(res, 403, "Synthetic runner not configured", "text/plain; charset=utf-8"); return; }
          if (running || busy || agentRun.status === "running") { respond(res, 409, "Run already in progress", "text/plain; charset=utf-8"); return; }
          const params = new URLSearchParams(await bodyText(req));
          if (params.size !== 1 || params.getAll("csrf").length !== 1 ||
              !secureEqual(params.get("csrf") ?? "", csrf)) {
            respond(res, 403, "Invalid run token", "text/plain; charset=utf-8"); return;
          }
          // Reserve the runner synchronously; subsequent requests can inspect status.
          running = true;
          runState = { status: "running", startedAt: new Date().toISOString() };
          journal.append({ type: "run.started" });
          void (async () => {
            try {
              const raw: unknown = JSON.parse(await readFile(resolve(syntheticInputFile), "utf8"));
              if (!Array.isArray(raw) || raw.length > 100 || raw.some(j => !j || typeof j !== "object")) throw new Error("Invalid synthetic jobs");
              jobProgress = (raw as EvidenceBatchJob[]).map(job => ({ id: job.id, status: "queued", stage: "queued", completed: 0, total: 3 }));
              const report = await runLocalWorkbench(raw as EvidenceBatchJob[], join(base, "checkpoints"), { concurrency: 2, maxJobs: 100 }, (id, stage, completed, total) => {
                const job = jobProgress.find(item => item.id === id);
                if (job) { job.status = "running"; job.stage = stage; job.completed = completed; job.total = total; }
                journal.append({ type: stage === "checkpoint-reused" ? "job.checkpoint.reused" : "job.stage.completed", jobId: id, stage, completed, total });
              });
              for (const result of report.jobs) {
                const job = jobProgress.find(item => item.id === result.id);
                if (job) { job.status = result.status; job.completed = result.stages.length; job.stage = result.stages.at(-1) ?? "none"; }
                journal.append({ type: "job.finished", jobId: result.id, status: result.status });
              }
              const output = join(base, "report.json");
              const temporary = join(base, "report.pending.json");
              await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
              await rename(temporary, output);
              runState = { ...runState, status: "completed", finishedAt: new Date().toISOString() };
              journal.append({ type: "run.completed" });
            } catch {
              runState = { ...runState, status: "failed", finishedAt: new Date().toISOString() };
              journal.append({ type: "run.failed" });
            } finally {
              running = false;
            }
          })();
          res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
          res.end(); return;
        }
        if (busy || running || agentRun.status === "running") { respond(res, 409, "Review in progress", "text/plain; charset=utf-8"); return; }
        busy = true;
        try {
          const params = new URLSearchParams(await bodyText(req));
          const keys = ["csrf", "jobId", "digest", "reviewer", "decision"];
          if ([...params.keys()].some(k => !keys.includes(k)) || keys.some(k => params.getAll(k).length !== 1) ||
              !secureEqual(params.get("csrf") ?? "", csrf)) {
            respond(res, 403, "Forbidden: invalid form token or fields", "text/plain; charset=utf-8"); return;
          }
          const jobId = params.get("jobId") ?? "";
          const reviewer = params.get("reviewer") ?? "";
          const digest = params.get("digest") ?? "";
          const decision = params.get("decision") ?? "";
          if (!validId(jobId) || !validId(reviewer) || !["approved", "rejected"].includes(decision)) {
            respond(res, 400, "Invalid review fields", "text/plain; charset=utf-8"); return;
          }
          const report = JSON.parse(await readFile(join(base, "report.json"), "utf8")) as WorkbenchReport;
          await recordReview(ledgerPath, report, jobId, reviewer, decision as "approved" | "rejected", digest);
          res.writeHead(303, { Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
          res.end(); return;
        } finally { busy = false; }
      }
      if (requestUrl.pathname === "/agents/history/view") {
        if (req.method !== "GET") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
        const id = requestUrl.searchParams.get("id") ?? "";
        if (!validId(id)) { respond(res, 400, "Invalid job", "text/plain; charset=utf-8"); return; }
        const entries = await agentHistory.list(id);
        const rows = entries.map(entry => '<tr><td>' + entry.sequence + '</td><td>' + htmlEscape(entry.timestamp) +
          '</td><td>' + htmlEscape(entry.kind) + '</td><td>' + htmlEscape(entry.agentId ?? "-") +
          '</td><td>' + (entry.elapsedMs ?? "-") + '</td></tr>').join("");
        const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Histórico de agentes</title><style>body{font:16px system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><p><a href="/agents">Voltar aos agentes</a></p><h1>Histórico local: ' +
          htmlEscape(id) + '</h1><p>Somente metadados; tempos em milissegundos. Sem payloads ou mensagens de erro.</p><table><thead><tr><th>#</th><th>Data</th><th>Evento</th><th>Agente</th><th>Duração (ms)</th></tr></thead><tbody>' +
          rows + '</tbody></table></body></html>';
        respond(res, 200, html); return;
      }
      if (requestUrl.pathname === "/agents/history") {
        if (req.method !== "GET") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
        const id = requestUrl.searchParams.get("id") ?? "";
        if (!validId(id)) { respond(res, 400, "Invalid job", "text/plain; charset=utf-8"); return; }
        const entries = await agentHistory.list(id);
        respond(res, 200, JSON.stringify({ jobId: id, entries }), "application/json; charset=utf-8"); return;
      }
      if (requestUrl.pathname === "/agents/inspect") {
        if (req.method !== "GET") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
        const id = requestUrl.searchParams.get("id") ?? "";
        const html = renderAgentInspector(id, agentStates, agentRun);
        if (!html) { respond(res, 404, "Unknown agent", "text/plain; charset=utf-8"); return; }
        respond(res, 200, html); return;
      }
      if (requestUrl.pathname === "/diagrams") {
        if (req.method !== "GET") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
        const kind = requestUrl.searchParams.get("kind") ?? "execution";
        if (!["execution", "classes", "components", "sequence"].includes(kind)) {
          respond(res, 400, "Unknown diagram", "text/plain; charset=utf-8"); return;
        }
        respond(res, 200, renderDiagramsPage(kind as DiagramKind, agentStates, agentRun.status)); return;
      }
      if (requestUrl.pathname === "/agents/status") {
        respond(res, 200, JSON.stringify({ ...agentRun, agents: agentStates }), "application/json; charset=utf-8"); return;
      }
      if (requestUrl.pathname === "/agents") {
        const graph = renderAgentGraph(agentStates);
        const form = syntheticInputFile ? '<form method="post" action="/agents/run"><input type="hidden" name="csrf" value="' + csrf + '"><label>ID do job sintético <input name="jobId" required maxlength="80" pattern="[A-Za-z0-9_-]{1,80}" value="demo"></label><button type="submit">Executar agentes locais</button></form>' : "<p>Inicie o dashboard com um arquivo de jobs sintéticos para executar.</p>";
        const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migration Maestro — Agentes</title></head><body><p><a href="/">Voltar ao dashboard</a></p><h1>Centro de orquestração</h1><p><a href="/diagrams">Ver diagramas UML e execução</a></p><p>Execução: ' + htmlEscape(agentRun.status) + (agentRun.jobId ? " — " + htmlEscape(agentRun.jobId) : "") + '</p>' + form + graph + '<p>Resultado: simulação, sem chamadas a modelos ou escrita no AEM. Revisão humana permanece separada.</p></body></html>';
        respond(res, 200, html); return;
      }
      if (requestUrl.pathname === "/events") {
        const cursor = requestUrl.searchParams.get("after") ?? "0";
        if (!/^(0|[1-9][0-9]{0,12})$/.test(cursor)) { respond(res, 400, "Invalid cursor", "text/plain; charset=utf-8"); return; }
        respond(res, 200, JSON.stringify({ events: journal.list(Number(cursor)) }), "application/json; charset=utf-8"); return;
      }
      if (requestUrl.pathname === "/run-status") {
        respond(res, 200, JSON.stringify({ ...runState, jobs: jobProgress }), "application/json; charset=utf-8"); return;
      }
      const report = JSON.parse(await readFile(join(base, "report.json"), "utf8")) as WorkbenchReport;
      const ledger = await readReviewLedger(ledgerPath);
      if (requestUrl.pathname === "/job") {
        const id = requestUrl.searchParams.get("id");
        if (!id || !validId(id) || !report.jobs.some(j => j.id === id)) { respond(res, 404, "Job not found", "text/plain; charset=utf-8"); return; }
        respond(res, 200, renderJobInspector(report, ledger, id)); return;
      }
      const progressRows = jobProgress.map(job => `<tr><td>${htmlEscape(job.id)}</td><td>${htmlEscape(job.status)}</td><td>${htmlEscape(job.stage)}</td><td>${job.completed}/${job.total}</td></tr>`).join("");
      const progressHtml = progressRows ? `<section><h2>Progresso dos jobs (execução atual)</h2><table><thead><tr><th>Job</th><th>Status</th><th>Última etapa</th><th>Etapas</th></tr></thead><tbody>${progressRows}</tbody></table></section>` : "";
      const dashboard = renderReviewDashboard(report, ledger, csrf, running ? "Execução em andamento. Atualize para acompanhar." : runState.status === "failed" ? "Última execução falhou; relatório anterior preservado." : runState.status === "completed" ? "Última execução concluída." : "", Boolean(syntheticInputFile));
      respond(res, 200, dashboard.replace("<h2>Histórico</h2>", '<p><a href="/agents">Abrir centro de orquestração de agentes</a></p>' + progressHtml + "<h2>Histórico</h2>"));
    } catch {
      respond(res, 400, "Invalid or stale review; refresh the dashboard and verify the report.", "text/plain; charset=utf-8");
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolvePromise(); });
  });
  return server;
}
