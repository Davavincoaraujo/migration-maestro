import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderUmlClassDiagram } from "../src/workbench/uml-class-diagram.js";
import { renderDiagramsPage, renderMigrationDiagram } from "../src/workbench/migration-diagrams.js";
import { startReviewServer } from "../src/workbench/review-server.js";

test("UML classes expose real TypeScript contracts, compartments and associations", () => {
  const diagram = renderUmlClassDiagram();
  for (const name of ["MigrationAgentNode", "MigrationAgentPlan", "Checkpoint", "CheckpointStore", "MemoryCheckpointStore", "AgentExecutionResult", "MigrationAgentRole"]) {
    assert.ok(diagram.includes(name), name);
  }
  assert.match(diagram, /«interface»/);
  assert.match(diagram, /get\(id: string\)/);
  assert.match(diagram, /implements/);
  assert.match(diagram, /0\.\.\*/);
  assert.match(diagram, /<line/);
  assert.doesNotMatch(diagram, /<script|onclick=/i);
  assert.equal(renderMigrationDiagram("classes"), diagram);
  assert.match(renderDiagramsPage("classes", [], "idle"), /diagrams\?kind=classes/);
});

test("local dashboard serves UML class diagram and preserves other tabs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-uml-"));
  const server = await startReviewServer(dir, 0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Missing port");
    const base = "http://127.0.0.1:" + addr.port;
    const response = await fetch(base + "/diagrams?kind=classes");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /MigrationAgentNode/);
    for (const kind of ["execution", "components", "sequence"]) {
      assert.equal((await fetch(base + "/diagrams?kind=" + kind)).status, 200);
    }
    assert.equal((await fetch(base + "/diagrams?kind=unknown")).status, 400);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
