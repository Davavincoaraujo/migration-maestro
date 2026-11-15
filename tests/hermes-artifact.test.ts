import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validateAgentArtifact } from "../src/adapters/hermes/artifact-validator.js";

const valid = JSON.stringify({
  kind: "migration-analysis", version: 1, summary: "Página fictícia",
  components: ["hero", "faq"], risks: [], nextSteps: ["Revisar"]
});

test("accepts a valid artifact", () => {
  const result = validateAgentArtifact(valid);
  assert.equal(result.valid, true);
  assert.deepEqual(result.artifact?.components, ["hero", "faq"]);
});
test("rejects non-JSON output", () => assert.equal(validateAgentArtifact("hello").reason, "INVALID_JSON"));
test("rejects truncated output", () => assert.equal(validateAgentArtifact(valid, true).reason, "RESPONSE_TRUNCATED"));
test("rejects unexpected fields", () => assert.equal(validateAgentArtifact(valid.replace('"version":1', '"version":1,"secret":"x"')).reason, "INVALID_SCHEMA"));
test("rejects empty output", () => assert.equal(validateAgentArtifact("").reason, "EMPTY_RESPONSE"));
