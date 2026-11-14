import ts from "typescript";

export interface UmlMember { name: string; type: string; visibility: "+" | "-" | "#"; }
export interface UmlClass {
  name: string;
  stereotype: "«interface»" | "«class»" | "«union type»";
  attributes: UmlMember[];
  operations: UmlMember[];
  implements: string[];
}
export interface UmlAssociation { from: string; to: string; label: string; multiplicity: string; }
export interface UmlModel { classes: UmlClass[]; associations: UmlAssociation[]; }

const names = new Set(["MigrationAgentNode", "MigrationAgentPlan", "MigrationAgentRole",
  "Checkpoint", "CheckpointStore", "MemoryCheckpointStore", "AgentExecutionResult"]);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c] ?? c);
const sourceFiles = [
  "src/orchestration/agent-graph.ts",
  "src/orchestration/local-agent-executor.ts",
  "src/autopilot/checkpoint-runner.ts",
] as const;
const textOf = (node: ts.Node, source: ts.SourceFile): string => node.getText(source).replace(/\s+/g, " ").trim();
function memberName(node: ts.PropertyName | undefined, source: ts.SourceFile): string {
  return node ? textOf(node, source) : "anonymous";
}
function visibility(node: ts.Node): "+" | "-" | "#" {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node) ?? [];
    if (modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) return "-";
    if (modifiers.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) return "#";
  }
  return "+";
}
function typeText(node: ts.TypeNode | undefined, source: ts.SourceFile): string {
  return node ? textOf(node, source) : "inferred";
}
function methodText(node: ts.MethodDeclaration | ts.MethodSignature, source: ts.SourceFile): string {
  const args = node.parameters.map(p => textOf(p, source)).join(", ");
  return "(" + args + "): " + typeText(node.type, source);
}

/** Deterministic TypeScript AST extraction: no regex parsing, code execution, or network access. */
export function extractUmlModel(files: Readonly<Record<string, string>>): UmlModel {
  const classes: UmlClass[] = [];
  for (const path of sourceFiles) {
    const content = files[path];
    if (content === undefined) throw new Error("Missing UML source: " + path);
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if ((ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name && names.has(statement.name.text)) {
        const attributes: UmlMember[] = [];
        const operations: UmlMember[] = [];
        for (const member of statement.members) {
          if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
            attributes.push({
              name: memberName(member.name, source),
              type: typeText(member.type, source),
              visibility: visibility(member),
            });
          } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
            operations.push({
              name: memberName(member.name, source),
              type: methodText(member, source),
              visibility: visibility(member),
            });
          }
        }
        const implemented = ts.isClassDeclaration(statement) ?
          (statement.heritageClauses ?? []).filter(h => h.token === ts.SyntaxKind.ImplementsKeyword)
            .flatMap(h => h.types.map(t => textOf(t.expression, source))) : [];
        classes.push({ name: statement.name.text,
          stereotype: ts.isInterfaceDeclaration(statement) ? "«interface»" : "«class»",
          attributes, operations, implements: implemented });
      } else if (ts.isTypeAliasDeclaration(statement) && names.has(statement.name.text)) {
        classes.push({ name: statement.name.text, stereotype: "«union type»",
          attributes: [{ name: "values", type: textOf(statement.type, source), visibility: "+" }],
          operations: [], implements: [] });
      }
    }
  }
  const known = new Set(classes.map(c => c.name));
  const associations: UmlAssociation[] = [];
  for (const cls of classes) {
    for (const item of cls.attributes) {
      for (const target of known) {
        if (target !== cls.name && new RegExp("(^|[^A-Za-z0-9_])" + target + "([^A-Za-z0-9_]|$)").test(item.type)) {
          associations.push({ from: cls.name, to: target, label: item.name,
            multiplicity: item.type.includes("[]") || item.type.includes("Array<") ? "0..*" : "0..1" });
        }
      }
    }
    for (const target of cls.implements) {
      if (known.has(target)) associations.push({ from: cls.name, to: target, label: "implements", multiplicity: "1" });
    }
  }
  return { classes, associations };
}
function box(cls: UmlClass, x: number, y: number, width: number, height: number): string {
  const header = 56;
  const attrEnd = header + Math.max(1, cls.attributes.length) * 21 + 12;
  const attr = cls.attributes.map((m, i) =>
    '<text x="' + (x + 12) + '" y="' + (y + header + 22 + i * 21) + '" font-size="12">' +
    esc(m.visibility + " " + m.name + ": " + m.type) + '</text>').join("");
  const ops = cls.operations.map((m, i) =>
    '<text x="' + (x + 12) + '" y="' + (y + attrEnd + 22 + i * 21) + '" font-size="12">' +
    esc(m.visibility + " " + m.name + m.type) + '</text>').join("");
  return '<g><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
    '" fill="#fff9d9" stroke="#485568" stroke-width="1.5"/><rect x="' + x + '" y="' + y +
    '" width="' + width + '" height="' + header + '" fill="#e7edc5" stroke="#485568"/>' +
    '<text x="' + (x + width / 2) + '" y="' + (y + 19) + '" text-anchor="middle" font-size="12">' + esc(cls.stereotype) +
    '</text><text x="' + (x + width / 2) + '" y="' + (y + 41) + '" text-anchor="middle" font-size="16" font-weight="600">' +
    esc(cls.name) + '</text><line x1="' + x + '" y1="' + (y + attrEnd) +
    '" x2="' + (x + width) + '" y2="' + (y + attrEnd) + '" stroke="#485568"/>' + attr + ops + '</g>';
}
/** Server-rendered UML generated from parsed source declarations. */
export function renderUmlModel(model: UmlModel): string {
  const width = 1400, columns = 2, cellWidth = 680, gap = 35;
  const rows: number[] = [];
  const heights = model.classes.map(c => 56 + (Math.max(1, c.attributes.length) +
    Math.max(1, c.operations.length)) * 21 + 36);
  for (let i = 0; i < model.classes.length; i += columns) {
    rows.push(Math.max(...heights.slice(i, i + columns)) + 95);
  }
  const positions = model.classes.map((c, i) => ({
    x: 25 + (i % columns) * (cellWidth + gap),
    y: 35 + rows.slice(0, Math.floor(i / columns)).reduce((a, b) => a + b, 0),
    w: cellWidth,
    h: heights[i],
  }));
  const pos = new Map(model.classes.map((c, i) => [c.name, positions[i]]));
  const lines = model.associations.map(a => {
    const from = pos.get(a.from), to = pos.get(a.to);
    if (!from || !to) return "";
    const x1 = from.x + from.w / 2, y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2, y2 = to.y + to.h / 2;
    return '<path d="M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 +
      '" stroke="#6d7c89" stroke-width="2" fill="none"' +
      (a.label === "implements" ? ' stroke-dasharray="7 5"' : "") +
      '/><text x="' + ((x1 + x2) / 2) + '" y="' + ((y1 + y2) / 2 - 7) +
      '" font-size="12" fill="#334155">' + esc(a.label + " " + a.multiplicity) + '</text>';
  }).join("");
  const height = 70 + rows.reduce((a, b) => a + b, 0);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height +
    '" width="' + width + '" height="' + height +
    '" role="img" aria-label="Diagrama UML de classes gerado do TypeScript"><title>Diagrama UML de classes gerado do TypeScript</title>' +
    lines + model.classes.map((c, i) => box(c, positions[i].x, positions[i].y, positions[i].w, positions[i].h)).join("") +
    '</svg>';
}
export { sourceFiles as umlSourceFiles };
