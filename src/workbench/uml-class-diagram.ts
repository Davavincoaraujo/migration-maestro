/** UML class diagram for the existing TypeScript contracts; no inferred runtime relationships. */
const xml = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] ?? c);

type ClassBox = {
  name: string;
  stereotype: string;
  x: number;
  y: number;
  width: number;
  attributes: readonly string[];
  operations: readonly string[];
};
const classes: readonly ClassBox[] = [
  { name: "MigrationAgentNode", stereotype: "«interface»", x: 35, y: 50, width: 280,
    attributes: ["+ id: string", "+ role: MigrationAgentRole", "+ dependsOn: readonly string[]", "+ execution: synthetic | human-gate"],
    operations: [] },
  { name: "MigrationAgentPlan", stereotype: "«interface»", x: 410, y: 50, width: 350,
    attributes: ["+ schemaVersion: 1", "+ nodes: readonly MigrationAgentNode[]", "+ executionOrder: readonly string[]", "+ requiresHumanReview: true", "+ allowExternalWrites: false"],
    operations: [] },
  { name: "Checkpoint", stereotype: "«interface»", x: 35, y: 355, width: 280,
    attributes: ["+ version: 1", "+ jobId: string", "+ inputDigest: string", "+ completed: string[]", "+ outputs: Record<string, unknown>", "+ state: running | awaiting-review | failed"],
    operations: [] },
  { name: "CheckpointStore", stereotype: "«interface»", x: 410, y: 355, width: 350,
    attributes: [],
    operations: ["+ get(id: string): Promise<Checkpoint | undefined>", "+ put(checkpoint: Checkpoint): Promise<void>"] },
  { name: "MemoryCheckpointStore", stereotype: "«class»", x: 835, y: 355, width: 365,
    attributes: ["- items: Map<string, Checkpoint>"],
    operations: ["+ get(id: string): Promise<Checkpoint | undefined>", "+ put(value: Checkpoint): Promise<void>"] },
  { name: "AgentExecutionResult", stereotype: "«interface»", x: 835, y: 50, width: 365,
    attributes: ["+ jobId: string", "+ status: awaiting-review", "+ completedAgents: string[]", "+ outputs: Readonly<Record<string, unknown>>", "+ requiresHumanReview: true", "+ aemWritePerformed: false"],
    operations: [] },
  { name: "MigrationAgentRole", stereotype: "«union type»", x: 35, y: 665, width: 280,
    attributes: ["discovery | evidence | mapping", "composition | quality | review"],
    operations: [] },
];

function box(item: ClassBox): string {
  const { x, y, width, attributes, operations } = item;
  const row = 23;
  const header = 61;
  const attrHeight = Math.max(1, attributes.length) * row + 16;
  const opHeight = Math.max(1, operations.length) * row + 16;
  const height = header + attrHeight + opHeight;
  const attrs = attributes.map((a, i) =>
    '<text x="' + (x + 12) + '" y="' + (y + header + 25 + i * row) + '" font-size="13">' + xml(a) + '</text>'
  ).join("");
  const ops = operations.map((op, i) =>
    '<text x="' + (x + 12) + '" y="' + (y + header + attrHeight + 25 + i * row) + '" font-size="12">' + xml(op) + '</text>'
  ).join("");
  return '<g><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
    '" fill="#fff9d9" stroke="#485568" stroke-width="1.5"/>' +
    '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + header + '" fill="#e7edc5" stroke="#485568"/>' +
    '<text x="' + (x + width / 2) + '" y="' + (y + 22) + '" text-anchor="middle" font-size="12">' + xml(item.stereotype) + '</text>' +
    '<text x="' + (x + width / 2) + '" y="' + (y + 44) + '" text-anchor="middle" font-size="16" font-weight="600">' + xml(item.name) + '</text>' +
    '<line x1="' + x + '" y1="' + (y + header + attrHeight) + '" x2="' + (x + width) + '" y2="' + (y + header + attrHeight) + '" stroke="#485568"/>' +
    attrs + ops + '</g>';
}

export function renderUmlClassDiagram(): string {
  // Relationships reflect actual TypeScript declarations:
  // Plan.nodes contains MigrationAgentNode[]; CheckpointStore refers to Checkpoint;
  // MemoryCheckpointStore implements CheckpointStore; MigrationAgentNode.role is a role union.
  const edges = [
    '<path d="M 410 110 H 315" stroke="#485568" stroke-width="2" fill="none"/><path d="M 315 110 l12 -7 v14 Z" fill="#fff" stroke="#485568"/><text x="330" y="97" font-size="12">nodes</text><text x="386" y="126" font-size="12">1</text><text x="320" y="126" font-size="12">0..*</text>',
    '<path d="M 410 426 H 315" stroke="#485568" stroke-width="2" fill="none"/><text x="334" y="413" font-size="12">get / put</text><text x="386" y="445" font-size="12">1</text><text x="320" y="445" font-size="12">0..1</text>',
    '<path d="M 835 415 H 760" stroke="#485568" stroke-width="2" stroke-dasharray="7 5" fill="none"/><path d="M 760 415 l13 -8 v16 Z" fill="#fff" stroke="#485568"/><text x="768" y="398" font-size="12">implements</text>',
    '<path d="M 175 355 V 265 H 145 V 255" stroke="#485568" stroke-width="2" fill="none" stroke-dasharray="4 4"/><text x="183" y="288" font-size="12">IDs de etapas*</text>',
    '<path d="M 145 665 V 640 H 20 V 172 H 35" stroke="#485568" stroke-width="2" fill="none" stroke-dasharray="4 4"/><text x="24" y="627" font-size="12">role: tipo</text>',
  ].join("");
  const legend = '<text x="410" y="755" font-size="14">— associação de tipos   - -▷ implementação   · · dependência de tipo</text>' +
    '<text x="410" y="780" font-size="12">* Checkpoint.completed armazena IDs string; não contém instâncias de agentes.</text>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 810" width="1240" height="810" role="img" aria-label="Diagrama UML de classes dos contratos reais do Migration Maestro"><title>Diagrama UML de classes dos contratos reais do Migration Maestro</title>' +
    edges + classes.map(box).join("") + legend + '</svg>';
}
