export interface Entity { id: string; name: string; attributes: { name: string; type: string }[]; operations: { name: string; returns: string }[]; }
export interface Relation { from: string; to: string; kind: "association" | "composition" | "inheritance"; fromMultiplicity: string; toMultiplicity: string; }
export interface Requirement { id: string; title: string; description: string; acceptanceCriteria: string[]; entityIds: string[]; dependsOn: string[]; }
export interface Specification { schemaVersion: 1; projectId: string; title: string; entities: Entity[]; relations: Relation[]; requirements: Requirement[]; }
export interface Artifacts { schemaVersion: 1; projectId: string; traceability: { requirementId: string; entityIds: string[]; dependsOn: string[]; acceptanceCriteria: string[] }[]; diagrams: { classes: string; sequence: string; activity: string; components: string }; }
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v);
const validText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 500;
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error("Invalid analytics specification: " + message); }
function unique(ids: string[]): boolean { return new Set(ids).size === ids.length; }
export function parseSpecification(raw: unknown): Specification {
  check(raw && typeof raw === "object" && !Array.isArray(raw), "root");
  const s = raw as Record<string, unknown>;
  check(s.schemaVersion === 1 && validId(s.projectId) && validText(s.title), "header");
  check(Array.isArray(s.entities) && s.entities.length <= 40 &&
    Array.isArray(s.relations) && s.relations.length <= 100 &&
    Array.isArray(s.requirements) && s.requirements.length <= 100, "collections");
  const entities = s.entities as Entity[], relations = s.relations as Relation[], requirements = s.requirements as Requirement[];
  for (const e of entities) {
    check(e && validId(e.id) && validText(e.name) && Array.isArray(e.attributes) &&
      e.attributes.length <= 30 && Array.isArray(e.operations) && e.operations.length <= 30, "entity");
    for (const a of e.attributes) check(a && validText(a.name) && validText(a.type), "attribute");
    for (const op of e.operations) check(op && validText(op.name) && validText(op.returns), "operation");
  }
  check(unique(entities.map(e => e.id)), "duplicate entity");
  const entityIds = new Set(entities.map(e => e.id));
  for (const rel of relations) {
    check(rel && entityIds.has(rel.from) && entityIds.has(rel.to) &&
      ["association", "composition", "inheritance"].includes(rel.kind) &&
      validText(rel.fromMultiplicity) && validText(rel.toMultiplicity), "relation");
  }
  for (const req of requirements) {
    check(req && validId(req.id) && validText(req.title) && validText(req.description) &&
      Array.isArray(req.acceptanceCriteria) && req.acceptanceCriteria.length > 0 &&
      req.acceptanceCriteria.length <= 20 && req.acceptanceCriteria.every(validText) &&
      Array.isArray(req.entityIds) && req.entityIds.every((id: string) => entityIds.has(id)) &&
      unique(req.entityIds) && Array.isArray(req.dependsOn) && req.dependsOn.every(validId) &&
      unique(req.dependsOn), "requirement");
  }
  check(unique(requirements.map(r => r.id)), "duplicate requirement");
  const byId = new Map(requirements.map(r => [r.id, r]));
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    check(byId.has(id), "missing dependency");
    check(!visiting.has(id), "cyclic dependency");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.dependsOn) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  for (const req of requirements) visit(req.id);
  return structuredClone({ schemaVersion: 1, projectId: s.projectId, title: s.title, entities, relations, requirements } as Specification);
}
const safe = (s: string): string => s.replace(/https?:\/\/\S+/gi, " ").replace(/[^A-Za-z0-9_ .,:()-]/g, " ").slice(0, 120);
const safeMultiplicity = (s: string): string => s.replace(/[^0-9.*]/g, "").slice(0, 20);
export function buildArtifacts(input: Specification): Artifacts {
  const s = parseSpecification(input);
  const classes = ["classDiagram"];
  for (const e of s.entities) {
    classes.push("class " + e.id + " {");
    for (const a of e.attributes) classes.push("  +" + safe(a.name) + ": " + safe(a.type));
    for (const op of e.operations) classes.push("  +" + safe(op.name) + "() " + safe(op.returns));
    classes.push("}");
  }
  for (const rel of s.relations) {
    const edge = rel.kind === "composition" ? "*--" : rel.kind === "inheritance" ? "<|--" : "--";
    classes.push(rel.from + ' "' + safeMultiplicity(rel.fromMultiplicity) + '" ' + edge + ' "' + safeMultiplicity(rel.toMultiplicity) + '" ' + rel.to);
  }
  const sequence = ["sequenceDiagram", "participant Analytics", "participant Maestro", "participant Reviewer"];
  for (const req of s.requirements) {
    sequence.push("Analytics->>Maestro: " + req.id + " " + safe(req.title));
    sequence.push("Maestro-->>Reviewer: Review " + req.id);
  }
  sequence.push("Note over Maestro,Reviewer: Human approval required");
  const activity = ["flowchart TD", "START([Start])"];
  for (const req of s.requirements) activity.push(req.id + '["' + req.id + " " + safe(req.title) + '"]');
  for (const req of s.requirements) {
    if (!req.dependsOn.length) activity.push("START --> " + req.id);
    for (const dep of req.dependsOn) activity.push(dep + " --> " + req.id);
  }
  activity.push("REVIEW{Human approval required}");
  for (const req of s.requirements.filter(r => !s.requirements.some(next => next.dependsOn.includes(r.id)))) activity.push(req.id + " --> REVIEW");
  if (!s.requirements.length) activity.push("START --> REVIEW");
  const components = ["flowchart LR", "ANALYTICS[Migration Analytics]", "SPEC[Versioned specification]", "MAESTRO[Migration Maestro]", "REVIEW[Human review]", "ANALYTICS --> SPEC", "SPEC --> MAESTRO", "MAESTRO --> REVIEW"];
  for (const e of s.entities) components.push("MAESTRO -.-> " + e.id + '["' + safe(e.name) + '"]');
  return { schemaVersion: 1, projectId: s.projectId,
    traceability: s.requirements.map(r => ({ requirementId: r.id, entityIds: [...r.entityIds], dependsOn: [...r.dependsOn], acceptanceCriteria: [...r.acceptanceCriteria] })),
    diagrams: { classes: classes.join("\n"), sequence: sequence.join("\n"), activity: activity.join("\n"), components: components.join("\n") } };
}
