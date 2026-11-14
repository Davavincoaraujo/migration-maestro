import type { AgentHistoryEntry } from "./agent-history.js";
import { defaultMigrationAgents } from "../orchestration/agent-graph.js";

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] ?? c);
const validId = (s: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(s);
export interface AgentMetric {
  id: string;
  completed: number;
  reused: number;
  measuredEvents: number;
  totalElapsedMs: number;
  averageElapsedMs: number | null;
}
export interface JobMetric {
  id: string;
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  completedAgents: number;
  reusedEvents: number;
  latestEvent: string;
}
export interface ObservabilitySummary {
  totalEvents: number;
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  reusedEvents: number;
  agents: AgentMetric[];
  jobs: JobMetric[];
}
/** Aggregates bounded, persisted metadata only; no handler inputs or outputs. */
export function summarizeAgentHistory(entries: readonly AgentHistoryEntry[]): ObservabilitySummary {
  const agents = defaultMigrationAgents.filter(n => n.execution !== "human").map(n => {
    const events = entries.filter(e => e.agentId === n.id);
    const durations = events.filter(e => (e.kind === "agent.completed" || e.kind === "agent.reused") && e.elapsedMs !== undefined);
    const totalElapsedMs = durations.reduce((sum, e) => sum + (e.elapsedMs ?? 0), 0);
    return {
      id: n.id,
      completed: events.filter(e => e.kind === "agent.completed").length,
      reused: events.filter(e => e.kind === "agent.reused").length,
      measuredEvents: durations.length,
      totalElapsedMs,
      averageElapsedMs: durations.length ? Math.round(totalElapsedMs / durations.length) : null,
    };
  });
  const jobs = new Map<string, JobMetric>();
  for (const e of entries) {
    const job = jobs.get(e.jobId) ?? {
      id: e.jobId, runsStarted: 0, runsCompleted: 0, runsFailed: 0,
      completedAgents: 0, reusedEvents: 0, latestEvent: e.timestamp,
    };
    if (e.kind === "run.started") job.runsStarted++;
    if (e.kind === "run.completed") job.runsCompleted++;
    if (e.kind === "run.failed") job.runsFailed++;
    if (e.kind === "agent.completed") job.completedAgents++;
    if (e.kind === "agent.reused") job.reusedEvents++;
    job.latestEvent = e.timestamp;
    jobs.set(e.jobId, job);
  }
  return {
    totalEvents: entries.length,
    runsStarted: entries.filter(e => e.kind === "run.started").length,
    runsCompleted: entries.filter(e => e.kind === "run.completed").length,
    runsFailed: entries.filter(e => e.kind === "run.failed").length,
    reusedEvents: entries.filter(e => e.kind === "agent.reused").length,
    agents,
    jobs: [...jobs.values()].reverse(),
  };
}
export function renderObservabilityCenter(entries: readonly AgentHistoryEntry[], selectedJob?: string): string {
  if (selectedJob !== undefined && !validId(selectedJob)) throw new Error("Invalid job");
  const summary = summarizeAgentHistory(entries);
  const scoped = selectedJob ? entries.filter(e => e.jobId === selectedJob) : entries;
  const scopedSummary = summarizeAgentHistory(scoped);
  const agentRows = scopedSummary.agents.map(a =>
    '<tr><td><a href="/diagrams?kind=execution&amp;agent=' + encodeURIComponent(a.id) + '">' + esc(a.id) +
    '</a></td><td>' + a.completed + '</td><td>' + a.reused + '</td><td>' +
    (a.averageElapsedMs ?? "—") + '</td></tr>').join("");
  const jobRows = summary.jobs.map(j =>
    '<tr><td><a href="/observability?job=' + encodeURIComponent(j.id) + '">' + esc(j.id) +
    '</a></td><td>' + j.runsStarted + '</td><td>' + j.runsCompleted +
    '</td><td>' + j.runsFailed + '</td><td>' + j.completedAgents + '</td><td>' +
    j.reusedEvents + '</td><td>' + esc(j.latestEvent) + '</td></tr>').join("");
  const events = scoped.slice(-30).reverse().map(e =>
    '<tr><td>' + e.sequence + '</td><td>' + esc(e.timestamp) + '</td><td>' +
    esc(e.jobId) + '</td><td>' + esc(e.kind) + '</td><td>' +
    (e.agentId ? '<a href="/agents/inspect?id=' + encodeURIComponent(e.agentId) + '">' + esc(e.agentId) + '</a>' : '—') +
    '</td><td>' + (e.elapsedMs ?? "—") + '</td></tr>').join("");
  const jobLabel = selectedJob ? ' — job ' + esc(selectedJob) : ' — todos os jobs';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="5"><title>Migration Maestro — Observabilidade</title>' +
    '<style>body{font:15px system-ui,sans-serif;max-width:1250px;margin:2rem auto;padding:0 1rem;color:#152432}' +
    'a{color:#175a9a}table{width:100%;border-collapse:collapse;margin-bottom:2rem}td,th{border-bottom:1px solid #d8e0e8;padding:9px;text-align:left}' +
    '.metrics{display:flex;flex-wrap:wrap;gap:12px}.metric{border:1px solid #ccd8e2;border-radius:10px;padding:14px;min-width:125px}' +
    '.metric strong{display:block;font-size:25px}aside{background:#eef3f9;padding:12px;border-radius:8px}</style></head><body>' +
    '<p><a href="/agents">Agentes</a> · <a href="/diagrams?kind=execution">Diagrama de execução</a> · ' +
    '<a href="/diagrams?kind=classes">Classes UML</a> · <a href="/observability">Todos os jobs</a> · ' +
    '<a href="/observability/data' + (selectedJob ? '?job=' + encodeURIComponent(selectedJob) : '') + '">JSON de métricas</a></p>' +
    '<h1>Observability Center' + jobLabel + '</h1>' +
    '<aside>Dados locais e sintéticos. Contagens representam eventos persistidos, não execuções únicas por agente. ' +
    'Duração média calculada somente para eventos com tempo registrado. Revisão humana obrigatória; nenhuma escrita no AEM.</aside>' +
    '<div class="metrics">' +
    ([["Eventos",scopedSummary.totalEvents],["Iniciadas",scopedSummary.runsStarted],["Concluídas",scopedSummary.runsCompleted],
      ["Falhas",scopedSummary.runsFailed],["Reusos",scopedSummary.reusedEvents]] as const).map(([label,value]) =>
      '<div class="metric"><strong>' + value + '</strong>' + label + '</div>').join("") + '</div>' +
    '<h2>Métricas por agente</h2><table><thead><tr><th>Agente</th><th>Concluído</th><th>Reuso</th><th>Média (ms)</th></tr></thead><tbody>' +
    agentRows + '</tbody></table><h2>Jobs registrados</h2><table><thead><tr><th>Job</th><th>Iniciadas</th><th>Concluídas</th><th>Falhas</th><th>Agentes concluídos</th><th>Reusos</th><th>Último evento</th></tr></thead><tbody>' +
    (jobRows || '<tr><td colspan="7">Nenhum job registrado</td></tr>') + '</tbody></table>' +
    '<h2>Últimos 30 eventos' + jobLabel + '</h2><table><thead><tr><th>#</th><th>Data</th><th>Job</th><th>Evento</th><th>Agente</th><th>Duração (ms)</th></tr></thead><tbody>' +
    (events || '<tr><td colspan="6">Nenhum evento registrado</td></tr>') + '</tbody></table></body></html>';
}
