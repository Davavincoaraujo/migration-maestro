import test from "node:test";
import assert from "node:assert/strict";
import { inspectModelRouter } from "../src/integrations/model-router-inspection.js";
import type { discoverInstalledModels } from "../src/integrations/model-discovery.js";
import { inspectMaestriModelSessions } from "../src/integrations/maestri-model-router.js";

const discover: typeof discoverInstalledModels = async () => ({
  codex: { state: "discovered", models: [{ provider: "codex", id: "gpt-6-astra", displayName: "GPT-6-Astra", profile: "ADVANCED", supportedEffort: ["high"], availability: "cli-catalog", source: "codex-cli-catalog", price: null, usageMetrics: null }] },
  claude: { state: "unavailable", models: [] },
});

test("IPC denial preserves model catalog without inventing sessions, entitlement or costs", async () => {
  const result = await inspectModelRouter({ discover, transport: async () => { throw Error("EPERM SECRET_DO_NOT_EXPOSE"); } });
  assert.equal(result.maestri.state, "unavailable");
  assert.equal(result.providerCatalogs.codex.cliListedModels[0].id, "gpt-6-astra");
  assert.equal(result.providerCatalogs.codex.prices, null);
  assert.deepEqual(result.connectedMaestriSessions, []);
  assert.ok(result.routeDecisions.every(r => r.action === "blocked"));
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DO_NOT_EXPOSE/);
});

test("visible model identity alone does not prove session availability", async () => {
  const result = await inspectModelRouter({ discover, transport: async (command) => command === "list"
    ? 'Connected agents:\n - name: "Hermes"\nConnected portals:\n'
    : 'GPT-6-Astra default · ~/project · task' });
  assert.equal(result.maestri.state, "connected");
  assert.equal(result.connectedMaestriSessions[0].modelId, "gpt-6-astra");
  assert.equal(result.connectedMaestriSessions[0].diagnostic, "MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED");
  assert.ok(result.routeDecisions.every(r => r.action === "blocked"));
  assert.equal(result.routeDecisions.find(r => r.stage === "MAP_COMPONENTS")?.action, "blocked");
});

test("responsive Hermes without exposed model metadata stays unknown despite the CLI catalog", async () => {
  const calls: string[] = [];
  const result = await inspectModelRouter({ discover, transport: async (command, args) => {
    calls.push([command, ...args].join(" "));
    return command === "list" ? 'Connected agents:\n - name: "Hermes"\nConnected portals:\n'
      : 'Hermes connected. Planning completed successfully.';
  } });
  const session = result.connectedMaestriSessions[0];
  assert.equal(result.maestri.state, "connected");
  assert.equal(session.provider, "unknown");
  assert.equal(session.modelId, null);
  assert.equal(session.profile, "UNKNOWN");
  assert.equal(session.availability, "unknown");
  assert.equal(session.diagnostic, "MAESTRI_SESSION_MODEL_NOT_EXPOSED");
  assert.ok(result.routeDecisions.every(route => route.action === "blocked"));
  assert.deepEqual(calls, ["list", "check Hermes"]);
});

test("failed session reads are diagnosed separately without leaking terminal errors", async () => {
  const registry = await inspectMaestriModelSessions(async () => { throw Error("EPERM SECRET_DO_NOT_EXPOSE"); },
    'Connected agents:\n - name: "Hermes"');
  assert.equal(registry.sessions[0].diagnostic, "MAESTRI_SESSION_CHECK_FAILED");
  assert.equal(registry.sessions[0].modelId, null);
  assert.equal(registry.candidates[0].availability, "unknown");
  assert.equal(registry.candidates[0].provider, "unknown");
  assert.equal(registry.candidates[0].profile, "UNKNOWN");
  assert.equal(registry.candidates[0].priceVerified, undefined);
  assert.doesNotMatch(JSON.stringify(registry), /SECRET_DO_NOT_EXPOSE/);
});

test("unmapped visible models retain their identity without inventing a profile", async () => {
  const result = await inspectModelRouter({ discover, transport: async command => command === "list"
    ? 'Connected agents:\n - name: "Hermes"' : 'GPT-unmapped-model · ~/project · task' });
  const session = result.connectedMaestriSessions[0];
  assert.equal(session.modelId, "gpt-unmapped-model");
  assert.equal(session.provider, "codex");
  assert.equal(session.profile, "UNKNOWN");
  assert.equal(session.diagnostic, "MAESTRI_SESSION_PROFILE_NOT_CONFIGURED");
  assert.ok(result.routeDecisions.every(route => route.action === "blocked"));
});
