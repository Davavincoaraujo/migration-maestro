import test from "node:test";
import assert from "node:assert/strict";
import { MaestroEventJournal } from "../src/integrations/event-journal.js";
import { ConnectorRegistry } from "../src/integrations/connector-contract.js";

test("event journal orders, bounds, and filters by cursor", () => {
  const journal = new MaestroEventJournal(2);
  journal.append({ type: "run.started" });
  journal.append({ type: "job.stage.completed", jobId: "demo", stage: "evidence", completed: 1, total: 3 });
  journal.append({ type: "run.completed" });
  assert.deepEqual(journal.list().map(event => event.sequence), [2, 3]);
  assert.deepEqual(journal.list(2).map(event => event.type), ["run.completed"]);
  assert.throws(() => journal.list(-1));
  assert.throws(() => journal.append({ type: "job.finished", jobId: "../secret" }));
});

test("connector registry denies unapproved capabilities and invalid responses", async () => {
  const registry = new ConnectorRegistry();
  registry.register({
    id: "synthetic-source",
    capabilities: ["source.read"],
    async invoke(request) { return { ...request, data: { synthetic: true }, readOnly: true as const }; },
  });
  const response = await registry.invoke("synthetic-source", { capability: "source.read", jobId: "demo" });
  assert.deepEqual(response.data, { synthetic: true });
  await assert.rejects(registry.invoke("synthetic-source", { capability: "target.preview", jobId: "demo" }));
  await assert.rejects(registry.invoke("missing", { capability: "source.read", jobId: "demo" }));
  assert.throws(() => registry.register({
    id: "unsafe", capabilities: ["source.write" as "source.read"],
    async invoke(request) { return { ...request, data: null, readOnly: true as const }; },
  }));
  registry.register({
    id: "broken", capabilities: ["job.status"],
    async invoke(request) { return { ...request, data: null, readOnly: false as true }; },
  });
  await assert.rejects(registry.invoke("broken", { capability: "job.status", jobId: "demo" }));
});
