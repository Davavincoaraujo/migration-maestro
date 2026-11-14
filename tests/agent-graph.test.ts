import test from "node:test";
import assert from "node:assert/strict";
import { defaultMigrationAgents, planLocalAgentGraph, type MigrationAgentNode } from "../src/orchestration/agent-graph.js";

test("plans deterministic local migration agents with mandatory human review", () => {
  const plan = planLocalAgentGraph(defaultMigrationAgents);
  assert.deepEqual(plan.executionOrder, ["discovery", "evidence", "mapping", "composition", "quality", "review"]);
  assert.equal(plan.requiresHumanReview, true);
  assert.equal(plan.allowExternalWrites, false);
  assert.equal(plan.nodes.at(-1)?.execution, "human-gate");
});
test("rejects cycles, missing review, and bypassing the human gate", () => {
  const base = defaultMigrationAgents.map(node => ({ ...node, dependsOn: [...node.dependsOn] }));
  assert.throws(() => planLocalAgentGraph(base.slice(0, -1)));
  assert.throws(() => planLocalAgentGraph(base.map(node => node.id === "discovery" ? { ...node, dependsOn: ["quality"] } : node)));
  assert.throws(() => planLocalAgentGraph(base.map(node => node.id === "review" ? { ...node, dependsOn: ["mapping"] } : node)));
  assert.throws(() => planLocalAgentGraph(base.map(node => node.id === "review" ? { ...node, execution: "synthetic" as const } : node)));
  assert.throws(() => planLocalAgentGraph([...base, { id: "unknown", role: "mapping", dependsOn: ["missing"], execution: "synthetic" } satisfies MigrationAgentNode]));
});
