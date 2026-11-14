import test from "node:test";
import assert from "node:assert/strict";
import { evaluateUeValidationGate } from "../src/integrations/ue-validation-gate.js";
import type { UePatternConfig } from "../src/integrations/local-ue-pattern.js";
const config: UePatternConfig = { cliDirectory: "/synthetic/ue", projectDirectory: "/synthetic/components" };
test("successful command remains unverified and requires human approval", async () => {
 const result = await evaluateUeValidationGate("components/banner", config, async () => ({ command: "validar", output: "SENSITIVE CORPORATE FINDINGS" }));
 assert.deepEqual(result, { status: "review_required", validation: "executed_unverified", cliSucceeded: true, humanApprovalRequired: true });
 assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
});
test("validation failure blocks gate without leaking errors", async () => {
 const result = await evaluateUeValidationGate("components/banner", config, async () => { throw new Error("PRIVATE FILE PATH"); });
 assert.equal(result.validation, "blocked");
 assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
test("missing config does not pass gate", async () => {
 assert.equal((await evaluateUeValidationGate("components/banner", null)).validation, "unavailable");
});
