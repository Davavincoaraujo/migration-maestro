import type { AgentHistoryEntry } from "./agent-history.js";
import { renderUmlClassDiagram } from "./uml-class-diagram.js";
import { defaultMigrationAgents, planLocalAgentGraph } from "../orchestration/agent-graph.js";
import type { AgentVisualState } from "./agent-graph-html.js";

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] ?? c);

export type DiagramKind = "execution" | "components" | "sequence" | "classes";
export function renderMigrationDiagram(kind: DiagramKind, states: readonly AgentVisualState[] = []): string {
  if (kind === "classes") return renderUmlClassDiagram();
  if (kind === "execution") {
    const plan = planLocalAgentGraph(defaultMigrationAgents);
    const status = new Map(states.map(s => [s.id, s.status]));
    const nodes = plan.nodes.map((node, i) => {
      const x = 32 + (i % 3) * 260;
      const y = 36 + Math.floor(i / 3) * 150;
      const state = status.get(node.id) ?? (node.role === "review" ? "awaiting-review" : "pending");
      const fill = state === "completed" || state === "reused" ? "#d9f5e6" : state === "failed" ? "#ffe1e1" : state === "awaiting-review" ? "#fff1ca" : "#eef3f9";
      return '<a href="/diagrams?kind=execution&amp;agent=' + encodeURIComponent(node.id) + '" aria-label="Inspecionar agente ' + escape(node.id) + '"><g><rect x="' + x + '" y="' + y + '" width="215" height="88" rx="12" fill="' + fill + '" stroke="#63788a"/><text x="' + (x + 15) + '" y="' + (y + 31) + '" font-size="17" font-weight="600">' + escape(node.role) + '</text><text x="' + (x + 15) + '" y="' + (y + 58) + '" font-size="13">' + escape(state) + '</text></g></a>';
    }).join("");
    const positions = new Map(plan.nodes.map((node, i) => [node.id, { x: 32 + (i % 3) * 260, y: 36 + Math.floor(i / 3) * 150 }]));
    const links = plan.nodes.flatMap(node => node.dependsOn.map(dep => {
      const from = positions.get(dep);
      const to = positions.get(node.id);
      if (!from || !to) return "";
      return '<path d="M ' + (from.x + 107) + ' ' + (from.y + 88) + ' L ' + (to.x + 107) + ' ' + to.y + '" fill="none" stroke="#526d88" stroke-width="2" marker-end="url(#arrow)"/>';
    })).join("");
    return svg("Diagrama de execução dos agentes", 800, 325, links + nodes);
  }
  if (kind === "components") {
    const labels = ["Dashboard local", "Orquestrador", "Agentes sintéticos", "Checkpoints", "MCP somente leitura", "Revisão humana"];
    const boxes = labels.map((label, i) => {
      const x = 28 + (i % 3) * 258, y = 35 + Math.floor(i / 3) * 135;
      return '<rect x="' + x + '" y="' + y + '" width="218" height="78" rx="10" fill="#eef3f9" stroke="#63788a"/><text x="' + (x + 12) + '" y="' + (y + 44) + '" font-size="15">' + escape(label) + '</text>';
    }).join("");
    return svg("Diagrama UML de componentes da arquitetura local", 800, 300, '<path d="M 137 113 V 150 M 395 113 V 150 M 653 113 V 150" stroke="#526d88" stroke-width="2" fill="none" marker-end="url(#arrow)"/>' + boxes);
  }
  const actors = ["Operador", "Dashboard", "Orquestrador", "Agentes", "Checkpoint", "Revisor"];
  const columns = actors.map((name, i) => {
    const x = 70 + i * 130;
    return '<text x="' + x + '" y="27" text-anchor="middle" font-size="13">' + escape(name) + '</text><line x1="' + x + '" y1="44" x2="' + x + '" y2="310" stroke="#9caeba" stroke-dasharray="5 4"/>';
  }).join("");
  const messages: [number, number, string][] = [[0,1,"Iniciar"],[1,2,"Criar job"],[2,3,"Executar etapas"],[3,4,"Salvar checkpoint"],[4,2,"Confirmar etapa"],[2,5,"Solicitar revisão"]];
  const arrows = messages.map(([from,to,label],i) => {
    const y = 72 + i * 38, a = 70 + from * 130, b = 70 + to * 130;
    return '<line x1="' + a + '" y1="' + y + '" x2="' + b + '" y2="' + y + '" stroke="#526d88" stroke-width="2" marker-end="url(#arrow)"/><text x="' + ((a+b)/2) + '" y="' + (y-7) + '" text-anchor="middle" font-size="11">' + escape(label) + '</text>';
  }).join("");
  return svg("Diagrama UML de sequência da migração sintética", 800, 340, columns + arrows);
}
function svg(title: string, width: number, height: number, body: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(title) + '" width="' + width + '" height="' + height + '"><title>' + escape(title) + '</title><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#526d88"/></marker></defs>' + body + '</svg>';
}
export function renderDiagramsPage(kind: DiagramKind, states: readonly AgentVisualState[], runStatus: string, selectedAgent?: string, history: readonly AgentHistoryEntry[] = [], jobId?: string): string {
  const links = (["execution", "classes", "components", "sequence"] as const).map(k =>
    '<a href="/diagrams?kind=' + k + '">' + ({ execution: "Execução", classes: "Classes UML", components: "Componentes UML", sequence: "Sequência UML" })[k] + '</a>'
  ).join(" · ");
  const agentLinks = ["discovery", "evidence", "mapping", "composition", "quality", "review"].map(id =>
    '<a href="/agents/inspect?id=' + id + '">' + id + '</a>'
  ).join(" · ");
  const plan = planLocalAgentGraph(defaultMigrationAgents);
  const selected = kind === "execution" ? plan.nodes.find(n => n.id === selectedAgent) : undefined;
  const state = selected ? states.find(item => item.id === selected.id)?.status ??
    (selected.role === "review" ? "awaiting-review" : "pending") : "";
  const events = selected ? history.filter(entry => entry.agentId === selected.id && (!jobId || entry.jobId === jobId)).slice(-12).reverse() : [];
  const eventRows = events.map(entry => '<tr><td>' + entry.sequence + '</td><td>' + escape(entry.timestamp) +
    '</td><td>' + escape(entry.kind) + '</td><td>' + (entry.elapsedMs ?? "-") + '</td></tr>').join("");
  const panel = selected ? '<section id="agent-detail" aria-label="Detalhes do agente"><h2>Agente selecionado: ' + escape(selected.id) +
    '</h2><p>Estado: ' + escape(state) + ' · Execução: ' + escape(selected.execution) +
    ' · Job: ' + escape(jobId ?? "nenhum") + '</p><p>Dependências: ' + escape(selected.dependsOn.join(", ") || "nenhuma") +
    '</p><h3>Eventos recentes deste agente</h3><table><thead><tr><th>#</th><th>Data</th><th>Evento</th><th>Tempo (ms)</th></tr></thead><tbody>' +
    (eventRows || '<tr><td colspan="4">Nenhum evento registrado</td></tr>') + '</tbody></table><p><a href="/agents/inspect?id=' +
    encodeURIComponent(selected.id) + '">Abrir inspeção completa</a> · <a href="/diagrams?kind=execution">Fechar detalhes</a></p></section>' : "";
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>Migration Maestro — Diagramas</title><style>body{font:16px system-ui,sans-serif;max-width:1300px;margin:2rem auto;padding:0 1rem;color:#152432}nav{margin:1rem 0 2rem}a{color:#175a9a}svg a{cursor:pointer}svg a:focus-visible rect{stroke:#0a55b5;stroke-width:4}section#agent-detail{border:1px solid #cbd5e1;border-radius:10px;padding:16px;margin:20px 0}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}aside{padding:12px;background:#eef3f9;border-radius:8px}</style></head><body><p><a href="/agents">Voltar aos agentes</a></p><h1>Diagramas de migração</h1><nav>' + links + '</nav><h2>Inspecionar agente</h2><nav>' + agentLinks + '</nav><aside>Estado local: ' + escape(runStatus) + '. Simulação sem escrita no AEM. Revisão humana obrigatória.</aside><figure>' + renderMigrationDiagram(kind, states) + '<figcaption>' + escape(kind) + ' — visualização local, atualizada a cada 5 segundos. Clique em um agente no diagrama para inspecioná-lo.</figcaption></figure>' + panel + '</body></html>';
}
