import type { WorkbenchReport } from "./local-workbench.js";
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch] ?? ch);
/** Static offline dashboard. Never injects arbitrary HTML from a job. */
export function renderWorkbenchHtml(report: WorkbenchReport): string {
  const rows = report.jobs.map(j => `<tr><td>${escapeHtml(j.id)}</td><td>${escapeHtml(j.status)}</td><td>${j.componentCount}</td><td>${escapeHtml(j.findings.join(", ") || "None")}</td><td>${escapeHtml(j.stages.join(" → "))}</td></tr>`).join("\n");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Migration Maestro — relatório local</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:3rem auto;padding:0 1rem;color:#17212b}h1{font-size:1.8rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #ddd;padding:12px}th{background:#f3f5f7}p{line-height:1.5}.summary{font-weight:600}</style>
</head><body><h1>Migration Maestro</h1><p>Relatório sintético local — somente leitura. Nenhuma publicação AEM autorizada.</p>
<p class="summary">Total: ${report.summary.total} · Revisão: ${report.summary.reviewRequired} · Bloqueados: ${report.summary.blocked} · Falhas: ${report.summary.failed} · Cancelados: ${report.summary.cancelled}</p>
<table><thead><tr><th>Job</th><th>Status</th><th>Componentes</th><th>Pendências</th><th>Etapas</th></tr></thead><tbody>${rows}</tbody></table>
<p>Etapas concluídas: ${report.metrics.completedStages} · Etapas executadas nesta rodada: ${report.metrics.stageExecutions} · Checkpoints reutilizados: ${report.metrics.reusedCheckpoints} · Duração da rodada: ${report.metrics.elapsedMs} ms. Custo de IA: R$ 0 (nenhuma chamada).</p></body></html>`;
}
