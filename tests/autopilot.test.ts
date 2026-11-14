import test from "node:test";
import assert from "node:assert/strict";
import { Autopilot, MemoryJobStore, jobId } from "../src/autopilot/job.js";
import { validateToolRequest } from "../src/mcp/contracts.js";
const page = { path: "/demo", title: "Demo", body: "Safe sample" };
test("autopilot leaves valid job awaiting human review", async () => {
  const store = new MemoryJobStore();
  const runner = new Autopilot(store);
  const [job] = await runner.run([page]);
  assert.equal(job.state, "awaiting-review");
  assert.equal(job.result?.approved, false);
  assert.ok(job.events.some(event => event.stage === "validate"));
  assert.equal((await store.get(jobId(page)))?.state, "awaiting-review");
});
test("completed jobs are idempotent", async () => {
  const runner = new Autopilot(new MemoryJobStore());
  const [first] = await runner.run([page]);
  const [second] = await runner.run([page]);
  assert.deepEqual(first, second);
});
test("validation failure cannot be approved", async () => {
  const [job] = await new Autopilot(new MemoryJobStore()).run([{ ...page, title: "" }]);
  assert.equal(job.state, "failed");
  assert.equal(job.result?.approved, false);
});
test("autopilot enforces batch limits", async () => {
  const runner = new Autopilot(new MemoryJobStore(), { maxPages: 1, retryLimit: 0 });
  assert.equal((await runner.run([page, { ...page, path: "/two" }])).length, 1);
});
test("MCP boundary rejects non-allowlisted actions", () => {
  assert.throws(() => validateToolRequest({ tool: "target.publish", args: {} }));
  assert.equal(validateToolRequest({ tool: "source.read", args: { path: "/demo" } }).tool, "source.read");
});
