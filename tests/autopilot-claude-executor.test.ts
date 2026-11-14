import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt, runClaudeInWorktree } from "../src/integrations/autopilot-claude-executor.js";
test("agent prompt is scoped and never authorizes publication", () => {
 const prompt = buildAgentPrompt("adapt_component", "principal/sections/banner/v1");
 assert.match(prompt, /src\/frontend\/components\/principal\/sections\/banner\/v1/);
 assert.match(prompt, /Do not access files outside/);
 assert.match(prompt, /git push/);
 assert.throws(() => buildAgentPrompt("adapt_component", "../secrets"), /INVALID_COMPONENT_PATH/);
});
test("agent execution requires explicit opt-in before any filesystem or CLI access", async () => {
 await assert.rejects(runClaudeInWorktree("/nonexistent", "/nonexistent", "principal/sections/banner/v1", { execute: false }), /EXECUTION_OPT_IN_REQUIRED/);
});
