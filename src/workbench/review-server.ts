import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
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
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) {
      respond(res, 403, "Forbidden", "text/plain; charset=utf-8"); return;
    }
    const requestUrl = new URL(req.url ?? "/", origin);
    if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/review" && requestUrl.pathname !== "/job" && requestUrl.pathname !== "/run") { respond(res, 404, "Not found", "text/plain; charset=utf-8"); return; }
    if (req.method !== "GET" && req.method !== "POST") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
    try {
      if (req.method === "POST") {
        // Browser form navigations can omit Origin/Fetch Metadata in embedded webviews.
        // An explicit foreign Origin or cross-site Fetch Metadata is always rejected.
        const requestOrigin = req.headers.origin;
        const fetchSite = req.headers["sec-fetch-site"];
        if ((requestUrl.pathname !== "/review" && requestUrl.pathname !== "/run") ||
            (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== "null") ||
            (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none")) {
          respond(res, 403, "Forbidden: request origin", "text/plain; charset=utf-8"); return;
        }
        if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
          respond(res, 415, "Unsupported form content type", "text/plain; charset=utf-8"); return;
        }
        if (requestUrl.pathname === "/run") {
          if (!syntheticInputFile) { respond(res, 403, "Synthetic runner not configured", "text/plain; charset=utf-8"); return; }
          if (running || busy) { respond(res, 409, "Run already in progress", "text/plain; charset=utf-8"); return; }
          const params = new URLSearchParams(await bodyText(req));
          if (params.size !== 1 || params.getAll("csrf").length !== 1 ||
              !secureEqual(params.get("csrf") ?? "", csrf)) {
            respond(res, 403, "Invalid run token", "text/plain; charset=utf-8"); return;
          }
          running = true;
          try {
            const raw: unknown = JSON.parse(await readFile(resolve(syntheticInputFile), "utf8"));
            if (!Array.isArray(raw) || raw.length > 100 || raw.some(j => !j || typeof j !== "object")) throw new Error("Invalid synthetic jobs");
            const report = await runLocalWorkbench(raw as EvidenceBatchJob[], join(base, "checkpoints"), { concurrency: 2, maxJobs: 100 });
            await writeFile(join(base, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
            res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
            res.end(); return;
          } finally { running = false; }
        }
        if (busy || running) { respond(res, 409, "Review in progress", "text/plain; charset=utf-8"); return; }
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
      const report = JSON.parse(await readFile(join(base, "report.json"), "utf8")) as WorkbenchReport;
      const ledger = await readReviewLedger(ledgerPath);
      if (requestUrl.pathname === "/job") {
        const id = requestUrl.searchParams.get("id");
        if (!id || !validId(id) || !report.jobs.some(j => j.id === id)) { respond(res, 404, "Job not found", "text/plain; charset=utf-8"); return; }
        respond(res, 200, renderJobInspector(report, ledger, id)); return;
      }
      respond(res, 200, renderReviewDashboard(report, ledger, csrf, "", Boolean(syntheticInputFile)));
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
