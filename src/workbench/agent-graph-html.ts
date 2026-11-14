import { defaultMigrationAgents, planLocalAgentGraph } from "../orchestration/agent-graph.js";

export interface AgentVisualState {
  id: string;
  status: "pending" | "running" | "completed" | "reused" | "awaiting-review" | "failed";
}
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char] ?? char);

/** Static, CSP-safe HTML graph. No client JS or external assets. */
export function renderAgentGraph(states: readonly AgentVisualState[] = []): string {
  const plan = planLocalAgentGraph(defaultMigrationAgents);
  const byId = new Map(states.map(state => [state.id, state.status]));
  const cards = plan.nodes.map(node => {
    const status = byId.get(node.id) ?? (node.role === "review" ? "awaiting-review" : "pending");
    return `<li class="agent"><strong>${escapeHtml(node.role)}</strong><span>${escapeHtml(status)}</span><small>Depende de: ${escapeHtml(node.dependsOn.join(", ") || "início")}</small></li>`;
  }).join("");
  return `<section aria-label="Grafo de agentes"><h2>Orquestração de agentes — simulação local</h2><p>Fluxo sequencial com checkpoints. A revisão humana não é executada automaticamente.</p><ol class="agent-flow">${cards}</ol><style>.agent-flow{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:12px}.agent{border:1px solid #bdcbd6;border-radius:10px;padding:12px;min-width:130px;display:flex;flex-direction:column;gap:5px;background:#f4f7fa}.agent span{font-size:13px;color:#20527a}.agent small{font-size:12px;color:#526273}</style></section>`;
}
