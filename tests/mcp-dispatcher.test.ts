import test from "node:test";
import assert from "node:assert/strict";
import { createReadDispatcher } from "../src/mcp/dispatcher.js";
import { simulateUePattern } from "../src/mcp/ue-pattern-simulator.js";

test("allowlisted read tool invokes its configured handler", async () => {
  const dispatch = createReadDispatcher({ "job.status": async args => ({ id: args.id, status: "awaiting-review" }) });
  assert.deepEqual(await dispatch({ tool: "job.status", args: { id: "synthetic" } }), { ok: true, data: { id: "synthetic", status: "awaiting-review" } });
});
test("rejects write tools and sanitizes handler errors", async () => {
  const dispatch = createReadDispatcher({ "source.read": async () => { throw new Error("secret-data"); } });
  assert.equal((await dispatch({ tool: "target.publish", args: {} })).error, "tool-not-allowed");
  assert.deepEqual(await dispatch({ tool: "source.read", args: {} }), { ok: false, error: "tool-execution-failed" });
});
test("ue-pattern simulator cannot write AEM", () => {
  const result = simulateUePattern({ schemaVersion: 1, pageId: "demo", status: "review-required", components: [], findings: [], publishable: false });
  assert.equal(result.accepted, true);
  assert.equal(result.aemWritePerformed, false);
});
