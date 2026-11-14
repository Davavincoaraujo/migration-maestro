import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
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
export function renderReviewDashboard(report: WorkbenchReport, ledger: ReviewLedger, csrf: string, notice = ""): string {
  const rows = report.jobs.map(job => {
    const decision = ledger.entries.find(e => e.jobId === job.id);
    const status = decision ? decision.decision + " by " + decision.reviewer : job.status;
    let form = "";
    if (job.status === "review-required" && !decision && !job.findings.length) {
      const digest = reviewDigest(report, job.id);
      form = `<form method="post" action="/review"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="jobId" value="${htmlEscape(job.id)}"><input type="hidden" name="digest" value="${digest}"><label>Revisor <input name="reviewer" required maxlength="80" pattern="[A-Za-z0-9_-]{1,80}" autocomplete="off"></label><button name="decision" value="approved">Aprovar plano</button><button name="decision" value="rejected">Rejeitar</button></form>`;
    }
    return `<tr><td>${htmlEscape(job.id)}</td><td>${htmlEscape(status)}</td><td>${job.componentCount}</td><td>${htmlEscape(job.findings.join(", ") || "Nenhuma")}</td><td>${form || "Somente leitura"}</td></tr>`;
  }).join("");
  const history = ledger.entries.map(e => `<li>${htmlEscape(e.jobId)} — ${htmlEscape(e.decision)} por ${htmlEscape(e.reviewer)} em ${htmlEscape(e.decidedAt)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migration Maestro — Revisão local</title><style>body{font:16px system-ui,sans-serif;max-width:1150px;margin:3rem auto;padding:0 1rem;color:#152432}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:12px;text-align:left;vertical-align:top}th{background:#eef2f6}form{display:flex;gap:8px;flex-wrap:wrap}button,input{padding:8px}button{cursor:pointer}aside{padding:12px;background:#f4f6f9}small{color:#526273}</style></head><body><h1>Migration Maestro</h1><aside>Revisão humana local de planos sintéticos. Aprovar não publica no AEM e não concede permissão de escrita.</aside>${notice ? `<p role="status">${htmlEscape(notice)}</p>` : ""}<h2>Jobs (${report.summary.total})</h2><table><thead><tr><th>Job</th><th>Status</th><th>Componentes</th><th>Pendências</th><th>Decisão</th></tr></thead><tbody>${rows}</tbody></table><h2>Histórico</h2><ul>${history || "<li>Nenhuma decisão registrada</li>"}</ul><small>Etapas executadas: ${report.metrics.stageExecutions}; checkpoints reutilizados: ${report.metrics.reusedCheckpoints}. Servidor restrito ao loopback, sem integrações corporativas.</small></body></html>`;
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
export async function startReviewServer(directory: string, port = 4177) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const base = resolve(directory);
  const ledgerPath = join(base, "reviews.json");
  const csrf = randomBytes(32).toString("hex");
  let busy = false;
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) {
      respond(res, 403, "Forbidden", "text/plain; charset=utf-8"); return;
    }
    if (req.url !== "/" && req.url !== "/review") { respond(res, 404, "Not found", "text/plain; charset=utf-8"); return; }
    if (req.method !== "GET" && req.method !== "POST") { respond(res, 405, "Method not allowed", "text/plain; charset=utf-8"); return; }
    try {
      if (req.method === "POST") {
        const validOrigin = req.headers.origin === origin || (req.headers.origin === undefined && req.headers["sec-fetch-site"] === "same-origin");
        if (req.url !== "/review" || !validOrigin || !/^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
          respond(res, 403, "Forbidden", "text/plain; charset=utf-8"); return;
        }
        if (busy) { respond(res, 409, "Review in progress", "text/plain; charset=utf-8"); return; }
        busy = true;
        try {
          const params = new URLSearchParams(await bodyText(req));
          const keys = ["csrf", "jobId", "digest", "reviewer", "decision"];
          if ([...params.keys()].some(k => !keys.includes(k)) || keys.some(k => params.getAll(k).length !== 1) ||
              !secureEqual(params.get("csrf") ?? "", csrf)) {
            respond(res, 403, "Invalid review request", "text/plain; charset=utf-8"); return;
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
      respond(res, 200, renderReviewDashboard(report, ledger, csrf));
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
