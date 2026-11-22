import test from "node:test";
import assert from "node:assert/strict";
import { inspectWireChatContract, projectWireChatMetadata } from "../src/integrations/maestri-wire-contract.js";
import { parseMaestriSessionMetadata } from "../src/integrations/model-discovery.js";
import { readModelRouterConfig } from "../src/ai/model-router-config.js";

// Synthetic instances of the documented envelope, NOT real host captures.
const terminalId = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
const conversationId = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
const snapshot = () => ({ terminalId, conversationId, enabled: true, status: "idle",
  entries: [], unreadCount: 0, canClear: true });

test("documented required ChatSnapshot metadata survives without promoting evidence", () => {
  const result = inspectWireChatContract(snapshot(), terminalId);
  assert.deepEqual(result.metadata, { terminalId, conversationId, enabled: true, status: "idle", unreadCount: 0, canClear: true });
  assert.equal(result.terminalTargetMatches, true);
  assert.equal(result.modelObserved, false);
  assert.equal(result.identityVerified, false);
  assert.equal(result.availabilityVerified, false);
  assert.equal(result.availability, "unknown");
});

test("documented optional metadata and transcript are discarded; invented model fields ignored", () => {
  const value = { ...snapshot(), talkingToAgentName: "private-name", answeringAgentName: "private-name",
    threads: { activeSlot: 0, canSelect: true, items: [{ id: 0, color: "blue", hasMessages: true }] },
    appearance: { theme: "system", chatFont: "system", chatTextSize: "system", startInChatMode: true },
    turnInterrupted: false, showsShellWindow: false, hasOlderOnRecord: true,
    entries: [{ id: conversationId, role: "agent", ts: "2026-11-17T19:34:00Z", kind: "final",
      text: "private-transcript GPT-6-Astra low", segments: [], agentType: "codex" }],
    provider: "codex", modelId: "gpt-6-astra", effort: "low", availability: "available" };
  const result = inspectWireChatContract(value, terminalId);
  assert.deepEqual(result, inspectWireChatContract(snapshot(), terminalId));
  assert.doesNotMatch(JSON.stringify(result), /private-|gpt-6|codex/);
});

test("activity statuses, including stopped and future states, do not establish availability", () => {
  for (const status of ["idle", "working", "needsAttention", "notRunning", "unloaded", "futureStatus"]) {
    const result = inspectWireChatContract({ ...snapshot(), status, enabled: false }, terminalId);
    assert.equal(result.metadata?.status, status);
    assert.equal(result.identityVerified, false);
    assert.equal(result.availabilityVerified, false);
    assert.equal(result.availability, "unknown");
  }
});

test("target mismatch and conversation replacement cannot reuse previous identity", () => {
  assert.equal(inspectWireChatContract(snapshot(), conversationId).terminalTargetMatches, false);
  const changed = "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC";
  assert.equal(projectWireChatMetadata({ ...snapshot(), conversationId: changed })?.conversationId, changed);
  assert.equal(inspectWireChatContract(null, terminalId).metadata, null);
});

test("missing or malformed envelope metadata fails closed without leaking errors", () => {
  for (const key of Object.keys(snapshot())) {
    const value: Record<string, unknown> = snapshot();
    delete value[key];
    assert.equal(projectWireChatMetadata(value), null, key);
  }
  for (const value of [null, [], { ...snapshot(), terminalId: "secret-path" },
    { ...snapshot(), conversationId: null }, { ...snapshot(), enabled: "true" },
    { ...snapshot(), entries: {} }, { ...snapshot(), unreadCount: -1 },
    { ...snapshot(), unreadCount: 0.5 }, { ...snapshot(), status: "secret\ntext" }]) {
    const result = inspectWireChatContract(value, terminalId);
    assert.equal(result.metadata, null);
    assert.equal(result.terminalTargetMatches, false);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
});

test("CLI model observation is independent of identity and availability verification", async () => {
  const config = await readModelRouterConfig();
  for (const [text, observed] of [["GPT-6-Astra low", true], ["unknown", false]] as const) {
    const session = parseMaestriSessionMetadata("Hermes", text, config);
    assert.equal(session.modelObserved, observed);
    assert.equal(session.identityVerified, false);
    assert.equal(session.sessionIdentityVerified, false);
    assert.equal(session.availabilityVerified, false);
    assert.equal(session.availability, "unknown");
  }
});
