import test from "node:test";
import assert from "node:assert/strict";
import { evaluateUeValidationGate } from "../src/integrations/ue-validation-gate.js";
test("missing local configuration is unavailable", async () => {
 const result = await evaluateUeValidationGate("components/banner", null);
 assert.equal(result.validation, "unavailable");
 assert.equal(result.humanApprovalRequired, true);
});
