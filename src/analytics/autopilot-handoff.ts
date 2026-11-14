import { createHash } from "node:crypto";
import { parseSpecification, type Specification } from "./specification.js";

export type WorkItemStatus = "proposed" | "blocked";
export interface AnalyticsWorkItem {
  id: string;
  requirementId: string;
  title: string;
  description: string;
  entityIds: string[];
  acceptanceCriteria: string[];
  dependsOn: string[];
  status: WorkItemStatus;
  proposedAgents: readonly ["mapping", "composition", "quality"];
}
export interface AnalyticsHandoff {
  schemaVersion: 1;
  projectId: string;
  specificationDigest: string;
  status: "awaiting-human-review";
  requiresHumanReview: true;
  allowExternalWrites: false;
  aemWritePerformed: false;
  items: AnalyticsWorkItem[];
}
/** A proposal, not an execution instruction. Approval never triggers code or AEM writes. */
export function planAnalyticsHandoff(input: Specification): AnalyticsHandoff {
  const spec = parseSpecification(input);
  const canonical = JSON.stringify(spec);
  const digest = createHash("sha256").update(canonical).digest("hex");
  const byId = new Map(spec.requirements.map(req => [req.id, req]));
  const ordered: typeof spec.requirements = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    const req = byId.get(id);
    if (!req) throw new Error("Unknown requirement");
    for (const dependency of req.dependsOn) visit(dependency);
    visited.add(id);
    ordered.push(req);
  }
  for (const req of spec.requirements) visit(req.id);
  return {
    schemaVersion: 1,
    projectId: spec.projectId,
    specificationDigest: digest,
    status: "awaiting-human-review",
    requiresHumanReview: true,
    allowExternalWrites: false,
    aemWritePerformed: false,
    items: ordered.map(req => ({
      id: spec.projectId + "_" + req.id,
      requirementId: req.id,
      title: req.title,
      description: req.description,
      entityIds: [...req.entityIds],
      acceptanceCriteria: [...req.acceptanceCriteria],
      dependsOn: req.dependsOn.map(id => spec.projectId + "_" + id),
      status: req.dependsOn.length ? "blocked" : "proposed",
      proposedAgents: ["mapping", "composition", "quality"] as const,
    })),
  };
}
