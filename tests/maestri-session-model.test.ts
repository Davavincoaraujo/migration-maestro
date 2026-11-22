import test from "node:test";
import assert from "node:assert/strict";
import { readModelRouterConfig } from "../src/ai/model-router-config.js";
import { parseMaestriSessionMetadata } from "../src/integrations/model-discovery.js";
import { inspectMaestriModelSessions, routeMaestriStage } from "../src/integrations/maestri-model-router.js";

const config = await readModelRouterConfig();
const parse = (screen: string) => parseMaestriSessionMetadata("Hermes", screen, config);

test("known model with effort is identified independently of availability", () => {
  for (const effort of ["default", "low", "medium", "high", "xhigh", "max", "ultra"]) {
    const session = parse(`GPT-6-Astra ${effort} · ~/project · task`);
    assert.equal(session.modelId, "gpt-6-astra");
    assert.equal(session.profile, "ADVANCED");
    assert.equal(session.availability, "unknown");
    assert.equal(session.diagnostic, "MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED");
  }
});

test("unknown model and missing footer fail closed", () => {
  assert.equal(parse("GPT-unmapped low · ~/project").profile, "UNKNOWN");
  assert.equal(parse("GPT-unmapped low · ~/project").diagnostic, "MAESTRI_SESSION_PROFILE_NOT_CONFIGURED");
  for (const screen of ["", "Model changed to gpt-6-astra low", "GPT-6-Astra", "> GPT-6-Astra low · ~/project", "Example: GPT-6-Astra low · ~/project"]) {
    assert.equal(parse(screen).modelId, null);
    assert.equal(parse(screen).availability, "unknown");
  }
});

test("historical models and old footers cannot override the final footer", () => {
  const session = parse("GPT-6-Astra low · ~/project\nModel changed to gpt-6-astra low\nGPT-6.1-Sol high · ~/project");
  assert.equal(session.modelId, "gpt-6.1-sol");
  assert.equal(session.profile, "BALANCED");
  assert.equal(parse("GPT-6-Astra low · ~/project\nA later response without a footer").modelId, null);
  assert.equal(parse("Model changed to gpt-6-astra low\nGPT-unknown low · ~/project").profile, "UNKNOWN");
});

test("styling is supported but unrendered cursor controls are not trusted", () => {
  assert.equal(parse("\x1b[32mGPT-6-Astra low\x1b[0m · ~/project\n\n").modelId, "gpt-6-astra");
  assert.equal(parse("\x1b[2JGPT-6-Astra low · ~/project").modelId, null);
});

test("fresh inspection replaces a model and does not retain identity after a failed read", async () => {
  let screen = "GPT-6-Astra low · ~/project";
  let fail = false;
  const inspect = () => inspectMaestriModelSessions(async () => {
    if (fail) throw Error("unavailable");
    return screen;
  }, 'Connected agents:\n - name: "Hermes"', config);
  assert.equal((await inspect()).sessions[0].modelId, "gpt-6-astra");
  screen = "Model changed to gpt-6-astra low\nGPT-6.1-Sol low · ~/project";
  assert.equal((await inspect()).sessions[0].modelId, "gpt-6.1-sol");
  fail = true;
  const registry = await inspect();
  assert.equal(registry.sessions[0].modelId, null);
  assert.equal(registry.sessions[0].diagnostic, "MAESTRI_SESSION_CHECK_FAILED");
});

test("PLAN and IMPLEMENT require profile, availability and configured capability together", async () => {
  const registry = await inspectMaestriModelSessions(async () => "GPT-6-Astra low · ~/project", 'name: "Hermes"', config);
  const candidate = registry.candidates[0];
  for (const stage of ["PLAN", "IMPLEMENT"]) {
    assert.equal(routeMaestriStage(stage, [candidate]).action, "blocked");
    // Synthetic verified candidate tests router gates, not real account access.
    const verified = { ...candidate, availability: "available" as const };
    assert.notEqual(routeMaestriStage(stage, [verified]).action, "blocked");
    assert.equal(routeMaestriStage(stage, [{ ...verified, capabilities: [] }]).action, "blocked");
    assert.equal(routeMaestriStage(stage, [{ ...verified, profile: "UNKNOWN" }]).action, "blocked");
    assert.equal(routeMaestriStage(stage, [{ ...verified, availability: "unavailable" }]).action, "blocked");
  }
});

test("compact footer reported in the original shell accepts effort without a separator", () => {
  for (const [footer, id] of [
    ["GPT-6-Astra low", "gpt-6-astra"],
    ["GPT-6.1-Sol high", "gpt-6.1-sol"],
    ["Claude Sonnet 4.5 medium", "claude-sonnet-4.5"],
    ["GPT-future low", "gpt-future"],
  ]) {
    const session = parse(footer);
    assert.equal(session.modelId, id);
    assert.equal(session.availability, "unknown");
  }
  assert.equal(parse("GPT-6-Astra low\nLater conversation").modelId, null);
  assert.equal(parse("> GPT-6-Astra low").modelId, null);
});

// Model/effort/separator come from 2026-11-17. Auxiliary lines are synthetic:
// the original-shell diagnostic has not yet identified the real trailing line.
for (const [agent, model, effort] of [
  ["Hermes", "GPT-6-Astra", "low"],
  ["Analytics", "GPT-6.1-Sol", "default"],
  ["UE-Pattern", "GPT-6.1-Sol", "default"],
]) {
  test(`${agent}: reported model format with narrowly recognized auxiliary tail`, async () => {
    for (const auxiliary of ["? for shortcuts", "100% context left", "0% context left"]) {
      const screen = `private history\n${model} ${effort} · ~/redacted · task\n${auxiliary}`;
      const session = parseMaestriSessionMetadata(agent, screen, config);
      assert.equal(session.agentId, agent);
      assert.equal(session.agentAssociation, "command-target");
      assert.equal(session.modelId, model.toLowerCase());
      assert.equal(session.footerStructureRecognized, true);
      assert.equal(session.sessionIdentityVerified, false);
      assert.equal(session.currentFooterVerified, false);
      assert.equal(session.identityDiagnostic, "MAESTRI_SESSION_IDENTITY_NOT_VERIFIED");
      assert.equal(session.availability, "unknown");
      const registry = await inspectMaestriModelSessions(async () => screen, `name: "${agent}"`, config);
      for (const stage of ["PLAN", "ANALYZE", "MAP_COMPONENTS"]) {
        assert.equal(routeMaestriStage(stage, registry.candidates).action, "blocked");
      }
    }
  });
}

test("auxiliary grammar never skips arbitrary text, multiple hints, borders or controls", () => {
  for (const tail of ["conversation", "└────┘", "? for shortcuts secret", "101% context left", "01% context left",
    "? for shortcuts\n? for shortcuts", "? for shortcuts\nprivate text", "\u200b? for shortcuts", "\x1b[2K? for shortcuts"]) {
    assert.equal(parse(`GPT-6-Astra low · ~/project\n${tail}`).modelId, null, tail);
  }
  assert.equal(parse("GPT-6-Astra low\n? for shortcuts").modelId, null);
  assert.equal(parse("Claude Sonnet 4.5 medium · ~/project\n? for shortcuts").modelId, null);
  assert.equal(parse("GPT-6-Astra low · ~/project\u200b").modelId, null);
});
