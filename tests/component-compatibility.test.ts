import test from "node:test";
import assert from "node:assert/strict";
import { assessCompatibility, validateRequirements } from "../src/integrations/component-compatibility.js";
const req = { capabilities: ["carousel"], variants: ["hero"], fieldTypes: ["text"] };
const block = (x: unknown) => [{ type: "text", text: JSON.stringify(x) }];
test("full exact match is only a reuse candidate, never approved", () => {
 const a = assessCompatibility(req, block({ capabilities: ["CAROUSEL"], variants: ["hero"], fields: [{ type: "text" }] }));
 assert.deepEqual(a, { decision: "reuse_candidate", status: "review_required", required: 3, matched: 3, missing: 0, unsupportedEvidence: false });
});
test("partial match requires adaptation review", () => {
 const a = assessCompatibility(req, block({ capabilities: ["carousel"], variants: [], fields: [{ type: "number" }] }));
 assert.equal(a.decision, "adapt_candidate");
 assert.equal(a.missing, 2);
});
test("missing or malformed evidence cannot establish compatibility", () => {
 assert.equal(assessCompatibility(req, block({ capabilities: ["carousel"], variants: [], fields: [{}] })).decision, "insufficient_evidence");
 assert.equal(assessCompatibility(req, []).unsupportedEvidence, true);
});
test("invalid requirements are rejected", () => {
 assert.throws(() => validateRequirements({ capabilities: [], variants: [], fieldTypes: [] }), /EMPTY_REQUIREMENTS/);
});
