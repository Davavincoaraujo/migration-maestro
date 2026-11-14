/** Local-only agent orchestration contract; no remote model, MCP transport or AEM writes. */
export type MigrationAgentRole = "discovery" | "evidence" | "mapping" | "composition" | "quality" | "review";
export interface MigrationAgentNode {
  id: string;
  role: MigrationAgentRole;
  dependsOn: readonly string[];
  execution: "synthetic" | "human-gate";
}
export interface MigrationAgentPlan {
  schemaVersion: 1;
  nodes: readonly MigrationAgentNode[];
  executionOrder: readonly string[];
  requiresHumanReview: true;
  allowExternalWrites: false;
}
const roles: readonly MigrationAgentRole[] = ["discovery", "evidence", "mapping", "composition", "quality", "review"];
const validId = (value: string) => /^[a-z][a-z0-9-]{0,63}$/.test(value);

/** Validates a directed acyclic graph and returns a deterministic topological plan. */
export function planLocalAgentGraph(nodes: readonly MigrationAgentNode[]): MigrationAgentPlan {
  if (!nodes.length || nodes.length > 30) throw new Error("Invalid agent graph size");
  const byId = new Map<string, MigrationAgentNode>();
  for (const node of nodes) {
    if (!validId(node.id) || !roles.includes(node.role) || byId.has(node.id) ||
        (node.execution !== "synthetic" && node.execution !== "human-gate") ||
        (node.role === "review") !== (node.execution === "human-gate")) throw new Error("Invalid agent node");
    byId.set(node.id, node);
  }
  if (![...byId.values()].some(node => node.role === "review")) throw new Error("Human review gate required");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Agent graph cycle");
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new Error("Unknown agent dependency");
    visiting.add(id);
    if (new Set(node.dependsOn).size !== node.dependsOn.length || node.dependsOn.includes(id)) throw new Error("Invalid dependencies");
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const node of nodes) visit(node.id);
  const reviewNodes = nodes.filter(node => node.role === "review");
  if (reviewNodes.length !== 1 || order.at(-1) !== reviewNodes[0].id ||
      nodes.some(node => node.role !== "review" && !hasPath(node.id, reviewNodes[0].id, nodes))) {
    throw new Error("Review must be the final gate for all agents");
  }
  return {
    schemaVersion: 1,
    nodes: nodes.map(node => ({ ...node, dependsOn: [...node.dependsOn] })),
    executionOrder: order,
    requiresHumanReview: true,
    allowExternalWrites: false,
  };
}
function hasPath(from: string, to: string, nodes: readonly MigrationAgentNode[]): boolean {
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (id === to) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return nodes.some(node => node.dependsOn.includes(id) && walk(node.id));
  };
  return walk(from);
}
export const defaultMigrationAgents: readonly MigrationAgentNode[] = [
  { id: "discovery", role: "discovery", dependsOn: [], execution: "synthetic" },
  { id: "evidence", role: "evidence", dependsOn: ["discovery"], execution: "synthetic" },
  { id: "mapping", role: "mapping", dependsOn: ["evidence"], execution: "synthetic" },
  { id: "composition", role: "composition", dependsOn: ["mapping"], execution: "synthetic" },
  { id: "quality", role: "quality", dependsOn: ["composition"], execution: "synthetic" },
  { id: "review", role: "review", dependsOn: ["quality"], execution: "human-gate" },
];
