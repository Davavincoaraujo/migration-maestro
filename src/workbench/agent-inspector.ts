import type { AgentHistoryEntry } from "./agent-history.js";
import { defaultMigrationAgents, planLocalAgentGraph } from "../orchestration/agent-graph.js";
import type { AgentVisualState } from "./agent-graph-html.js";

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] ?? c);

/** Metadata-only inspector: never renders raw fixture inputs, handler outputs, or secrets. */
export function renderAgentInspector(
  id: string,
  states: readonly AgentVisualState[],
  run: { status: string; jobId?: string },
  history: readonly AgentHistoryEntry[] = [],
): string | null {
  const plan = planLocalAgentGraph(defaultMigrationAgents);
  const node = plan.nodes.find(item => item.id === id);
  if (!node) return null;
  const state = states.find(item => item.id === id)?.status ??
    (node.role === "review" ? "awaiting-review" : "pending");
  const dependencies = node.dependsOn.map(dep =>
    '<li><a href="/agents/inspect?id=' + encodeURIComponent(dep) + '">' + escape(dep) + '</a> — ' +
    escape(states.find(item => item.id === dep)?.status ?? "pending") + '</li>'
  ).join("");
  const dependents = plan.nodes.filter(item => item.dependsOn.includes(id))
    .map(item => '<li><a href="/agents/inspect?id=' + encodeURIComponent(item.id) + '">' + escape(item.id) + '</a></li>').join("");
  const events = history.filter(entry => entry.agentId === id && (!run.jobId || entry.jobId === run.jobId));
  const rows = events.slice(-20).reverse().map(entry =>
    '<tr><td>' + entry.sequence + '</td><td>' + escape(entry.timestamp) +
    '</td><td>' + escape(entry.kind) + '</td><td>' +
    (entry.elapsedMs === undefined ? '-' : entry.elapsedMs) + '</td></tr>'
  ).join("");
  const historyLink = run.jobId && /^[A-Za-z0-9_-]{1,80}$/.test(run.jobId) ?
    '<a href="/agents/history/view?id=' + encodeURIComponent(run.jobId) + '">Histórico completo do job</a>' : '';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Migration Maestro — Agente ' +
    escape(id) + '</title><style>body{font:16px system-ui,sans-serif;max-width:850px;margin:2rem auto;padding:0 1rem;color:#152432}section{border:1px solid #d5e0e8;border-radius:10px;padding:16px;margin:12px 0}a{color:#175a9a}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}dt{font-weight:600;margin-top:10px}dd{margin:3px 0}</style></head><body>' +
    '<p><a href="/diagrams">Voltar aos diagramas</a> · <a href="/agents">Orquestração</a></p>' +
    '<h1>Agente: ' + escape(id) + '</h1><section><h2>Estado</h2><dl><dt>Função</dt><dd>' + escape(node.role) +
    '</dd><dt>Estado</dt><dd>' + escape(state) + '</dd><dt>Tipo</dt><dd>' + escape(node.execution) +
    '</dd><dt>Job atual</dt><dd>' + escape(run.jobId ?? "nenhum") + '</dd><dt>Execução</dt><dd>' +
    escape(run.status) + '</dd></dl></section><section><h2>Dependências</h2><ul>' + (dependencies || "<li>Nenhuma</li>") +
    '</ul><h2>Próximos agentes</h2><ul>' + (dependents || "<li>Nenhum</li>") +
    '</ul></section><section><h2>Entradas, saídas e checkpoints</h2><p>Somente metadados de execução. ' +
    'Entradas e saídas brutas não são expostas pela interface.</p><p>Checkpoint: ' +
    (state === "completed" || state === "reused" ? "etapa concluída (conforme estado em memória)" : "não confirmado") +
    '.</p></section><section><h2>Histórico deste agente</h2><p>Últimos 20 eventos associados ao agente e ao job selecionado. Eventos de execução sem agente identificado aparecem apenas no histórico completo.</p>' +
    '<table><thead><tr><th>#</th><th>Data</th><th>Evento</th><th>Duração (ms)</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="4">Nenhum evento registrado</td></tr>') + '</tbody></table><p>' + historyLink +
    '</p></section><p>Simulação local. Revisão humana obrigatória; nenhuma publicação AEM.</p></body></html>';
}
