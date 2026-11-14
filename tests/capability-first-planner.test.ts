import test from "node:test";
import assert from "node:assert/strict";
import { planCapabilityCoverage, ensureExecutableSpecification } from "../src/integrations/capability-first-planner.js";
const requirements = { capabilities: ["carousel"], variants: ["hero"], fieldTypes: ["text"] };
test("missing core capability triggers alternative discovery, not component adaptation", () => {
 const result = planCapabilityCoverage(requirements, { capabilities: [], variants: ["hero"], fieldTypes: ["text"] });
 assert.equal(result.status, "discover_alternatives");
 assert.deepEqual(result.missing.capabilities, ["carousel"]);
 assert.equal(result.executionReady, false);
});
test("incomplete evidence never authorizes code", () => {
 assert.equal(planCapabilityCoverage(requirements, null).status, "insufficient_evidence");
 assert.throws(() => ensureExecutableSpecification(requirements, null), /IMPLEMENTATION_SPEC_REQUIRED/);
 assert.throws(() => ensureExecutableSpecification(requirements, { schemaVersion: 1, approved: true, componentPath: "x", acceptanceCriteria: [] }), /INVALID_IMPLEMENTATION_SPEC/);
});
