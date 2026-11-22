import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyModelSuccessHistory, readModelRouterHistory, recordModelRouteOutcome, type ModelRouteOutcome } from "../src/ai/model-router-history.js";
import type { AdaptiveModelCandidate } from "../src/ai/model-router.js";

const base: Omit<ModelRouteOutcome, "outcome" | "at"> = {
  jobId: "a".repeat(20), stage: "ANALYZE", taskType: "analysis", agentId: "Analytics",
  provider: "codex", modelId: "gpt-6.1-sol", attempts: 2, escalationCount: 0,
};

test("model history persists outcomes idempotently and supplies task-specific success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-router-history-"));
  const file = join(directory, "history.json");
  try {
    await recordModelRouteOutcome(file, { ...base, outcome: "failed", failureKind: "infrastructure", at: new Date().toISOString() });
    let history = await readModelRouterHistory(file);
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].failureKind, "infrastructure");
    const noPenalty: AdaptiveModelCandidate = { id: "Analytics", provider: "codex", modelId: "gpt-6.1-sol", profile: "BALANCED", capabilities: ["analysis"], availability: "available", source: "maestri-session" };
    assert.deepEqual({ ...applyModelSuccessHistory([noPenalty], history)[0].successRateByTask }, {});
    await recordModelRouteOutcome(file, { ...base, outcome: "success", at: new Date().toISOString() });
    history = await readModelRouterHistory(file);
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].outcome, "success");
    assert.deepEqual({ ...applyModelSuccessHistory([{
      id: "Analytics", provider: "codex", modelId: "gpt-6.1-sol", profile: "BALANCED", capabilities: ["analysis"],
      availability: "available", source: "maestri-session",
    }], history)[0].successRateByTask }, { analysis: 1 });
    const output = JSON.parse(await readFile(file, "utf8"));
    assert.equal(JSON.stringify(output).includes("token"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("history for a different agent does not influence the selected session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-router-history-invalid-"));
  const file = join(directory, "history.json");
  try {
    await recordModelRouteOutcome(file, { ...base, outcome: "success", at: new Date().toISOString() });
    const candidate: AdaptiveModelCandidate = { id: "x", provider: "codex", modelId: "gpt-6.1-sol", profile: "BALANCED", capabilities: [], availability: "available", source: "maestri-session" };
    assert.deepEqual({ ...applyModelSuccessHistory([candidate], await readModelRouterHistory(file))[0].successRateByTask }, {});
  } finally { await rm(directory, { recursive: true, force: true }); }
});
