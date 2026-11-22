import test from "node:test";
import assert from "node:assert/strict";
import { assertExecutionAuthorized, type ExecutionAuthorization } from "../src/autopilot/execution-authorization.js";
import { parseMigrateArguments } from "../src/cli-maestro-migrate.js";
const scope = { jobId: "a".repeat(20), project: "/tmp/portal", pageRoot: "/content/site", damRoot: "/content/dam/site", authorUrl: "http://localhost:4502" };
const approved: ExecutionAuthorization = { version: 1, ...scope, authorOrigin: "http://localhost:4502", environment: "non-production", portalEdits: true, aemCreate: true, approvedBy: "fixture operator" };
test("execution authority binds job, non-production origin, project, paths and operation", () => {
  assertExecutionAuthorized(approved, scope, "aemCreate");
  for (const patch of [{ jobId: "other" }, { project: "/tmp/other" }, { authorOrigin: "http://localhost:4503" }, { environment: "production" }, { aemCreate: false }, { pageRoot: "/content/other" }, { damRoot: "/content/dam/other" }, { approvedBy: "" }]) {
    assert.throws(() => assertExecutionAuthorized({ ...approved, ...patch } as ExecutionAuthorization, scope, "aemCreate"), /EXECUTION_AUTHORIZATION_REQUIRED/);
  }
  assert.throws(() => assertExecutionAuthorized(undefined, scope, "portalEdits"));
  assert.throws(() => assertExecutionAuthorized({ ...approved, portalEdits: false }, scope, "portalEdits"));
});
test("migration CLI rejects ambiguous arguments and never derives write approval from autopilot", () => {
  const parsed = parseMigrateArguments(["--url", "https://example.com/page", "--target", "/content/site/page", "--page-root", "/content/site", "--autopilot"]);
  assert.equal(parsed.policy, "plan-only"); assert.equal(parsed.authorizationFile, undefined); assert.equal(parsed.deferred, false);
  assert.equal(parseMigrateArguments(["--url", "https://example.com/page", "--target", "/content/site/page", "--page-root", "/content/site"]).deferred, true);
  for (const flags of [["--url"], ["--url", "x", "--target", "x", "--url", "y"], ["--url", "x", "--target", "x", "--policy", "approved"], ["--url", "x", "--target", "x", "--environment", "production"]]) assert.throws(() => parseMigrateArguments(flags));
});
