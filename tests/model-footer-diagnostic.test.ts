import test from "node:test";
import assert from "node:assert/strict";
import { readModelRouterConfig } from "../src/ai/model-router-config.js";
import { diagnoseModelFooter } from "../src/integrations/model-footer-diagnostic.js";

const config = await readModelRouterConfig();

test("synthetic penultimate candidate explains rejection without trusting it", () => {
  const report = diagnoseModelFooter("Hermes", "private conversation\nGPT-6-Astra low\n└────┘", config);
  assert.equal(report.parserDiagnostic, "MAESTRI_SESSION_MODEL_NOT_EXPOSED");
  assert.equal(report.candidates[0].distanceFromEnd, 1);
  assert.equal(report.candidates[0].candidateLine, "GPT-6-Astra low");
  assert.equal(report.candidates[0].followingLines[0].structuralLine, "└────┘");
  assert.equal(report.candidates[0].currentFooterVerified, false);
  assert.ok(!JSON.stringify(report).includes("private conversation"));
});

test("diagnostic redacts suffix and following conversation, exposes control codes only", () => {
  const report = diagnoseModelFooter("Analytics", "secret history\n\x1b[32mGPT-6.1-Sol high\x1b[0m · /secret/path\nsecret response\x1b[2K\u200b", config);
  const encoded = JSON.stringify(report);
  for (const secret of ["secret history", "/secret/path", "secret response"]) assert.ok(!encoded.includes(secret));
  assert.equal(report.candidates[0].separator, "·");
  assert.deepEqual(report.candidates[0].format.sgr, ["\x1b[32m", "\x1b[0m"]);
  assert.equal(report.candidates[0].followingLines[0].structuralLine, null);
  assert.equal(report.candidates[0].followingLines[0].hasOtherEscape, true);
  assert.deepEqual(report.candidates[0].followingLines[0].controls.map(c => c.code), ["U+001B", "U+200B"]);
});

test("synthetic compact and styled forms are diagnostic evidence, not real captures", () => {
  for (const line of ["GPT-6-Astra low", "GPT-6.1-Sol high", "\x1b[32mClaude Sonnet 4.5 medium\x1b[0m"]) {
    const report = diagnoseModelFooter("UE-Pattern", `${line}\r\n\r\n`, config);
    assert.equal(report.candidates[0].distanceFromEnd, 0);
    assert.equal(report.candidates[0].currentFooterVerified, false);
    assert.equal(report.parserDiagnostic, "MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED");
  }
  assert.deepEqual(diagnoseModelFooter("Hermes", "Example: GPT-6-Astra low", config).candidates, []);
});

test("trailing line classification is closed and never discloses unknown text", () => {
  for (const [line, classification] of [
    ["? for shortcuts", "shortcuts"], ["42% context left", "context-left"],
    ["└────┘", "border"], ["credential=private-secret", "unknown"],
    ["? for shortcuts\u200b", "unsafe-control"],
  ]) {
    const report = diagnoseModelFooter("Hermes", `GPT-6-Astra low · /private-path\n${line}`, config);
    assert.equal(report.candidates[0].followingLines[0].classification, classification);
    assert.equal(report.candidates[0].currentFooterVerified, false);
    assert.equal(report.sessionIdentityVerified, false);
    assert.equal(report.queriedAgent, "Hermes");
    assert.equal(report.agentAssociation, "command-target");
    assert.ok(!JSON.stringify(report).includes("private-secret"));
    assert.ok(!JSON.stringify(report).includes("private-path"));
  }
});

test("model classification is separate from auxiliary classification before redaction", () => {
  const report = diagnoseModelFooter("Hermes", "GPT-6-Astra low · /private-path\n  ? for shortcuts  ", config);
  const candidate = report.candidates[0];
  assert.equal(candidate.format.classification, "model-line");
  assert.equal(candidate.format.auxiliaryClassification, "unknown");
  assert.equal(candidate.format.classifierInput, "original-minus-sgr");
  assert.equal(candidate.followingLines[0].classification, "shortcuts");
  assert.equal(report.footerStructureRecognized, true);
  assert.ok(!JSON.stringify(report).includes("private-path"));
});

test("unknown real-length shapes and partial UI signals never authorize a footer", () => {
  // Synthetic probes, not substitutes for the unavailable 16:34 captures.
  for (const length of [32, 142]) {
    for (const prefix of ["? for shortcuts", "⚠ ctrl+c", "private-secret"]) {
      const tail = prefix.padEnd(length, "x");
      const report = diagnoseModelFooter("Analytics", `GPT-6.1-Sol default · /private-path\n${tail}`, config);
      const shape = report.candidates[0].followingLines[0];
      assert.equal(shape.length, length);
      assert.equal(shape.classification, "unknown");
      assert.equal(shape.signals.shortcutHint, prefix === "? for shortcuts");
      assert.equal(report.footerStructureRecognized, false);
      assert.equal(report.sessionIdentityVerified, false);
      assert.ok(!JSON.stringify(report).includes("private-secret"));
    }
  }
});

test("SGR preprocessing is shared; diagnostic does not scan older conversation", () => {
  const styled = diagnoseModelFooter("Hermes", "GPT-6-Astra low · redacted\n\x1b[32m? for shortcuts\x1b[0m", config);
  assert.equal(styled.candidates[0].followingLines[0].stylingRemoved, true);
  assert.equal(styled.candidates[0].followingLines[0].classification, "shortcuts");
  assert.equal(styled.footerStructureRecognized, true);
  const history = diagnoseModelFooter("Hermes", "GPT-secret-model low\na\nb\nc\nd\ne", config);
  assert.deepEqual(history.candidates, []);
  assert.ok(!JSON.stringify(history).includes("secret-model"));
});
