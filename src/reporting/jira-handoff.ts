import type { PageCompositionPlan } from "../planning/page-composition.js";
export interface JiraHandoff {
  schemaVersion: 1;
  summary: string;
  description: string;
  labels: string[];
  properties: { pageId: string; componentCount: number; status: PageCompositionPlan["status"] };
}
export function buildJiraHandoff(plan: PageCompositionPlan): JiraHandoff {
  if (plan.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(plan.pageId)) throw new Error("Invalid composition plan");
  const description = [
    "Migration Maestro — synthetic page composition",
    "Page ID: " + plan.pageId,
    "Status: " + plan.status,
    "Components: " + plan.components.length,
    "Findings: " + plan.findings.length,
    "Human review required. No AEM write or publication authorized.",
  ].join("\n");
  return {
    schemaVersion: 1,
    summary: "Review migration plan: " + plan.pageId,
    description,
    labels: ["migration-maestro", "human-review"],
    properties: { pageId: plan.pageId, componentCount: plan.components.length, status: plan.status },
  };
}
export function toJiraMarkdown(handoff: JiraHandoff): string {
  return "# " + handoff.summary + "\n\n" + handoff.description.split("\n").join("\n\n") + "\n";
}
