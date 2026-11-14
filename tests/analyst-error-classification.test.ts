import test from "node:test";
import assert from "node:assert/strict";
import { classifyAnalystToolError } from "../src/integrations/url-analysis-orchestrator.js";
test("classifies browser and network failures", () => {
 assert.equal(classifyAnalystToolError([{type:"text",text:"browser executable missing, install Playwright"}]),"ANALYST_BROWSER_BINARY_MISSING");
 assert.equal(classifyAnalystToolError([{type:"text",text:"Playwright browser failed to launch"}]),"ANALYST_BROWSER_LAUNCH_FAILED");
 assert.equal(classifyAnalystToolError([{type:"text",text:"Playwright error without details"}]),"ANALYST_BROWSER_RELATED_ERROR");
 assert.equal(classifyAnalystToolError([{type:"text",text:"Navigation timeout exceeded"}]),"ANALYST_TARGET_TIMEOUT");
 assert.equal(classifyAnalystToolError([{type:"text",text:"Validation error: missing required parameter"}]),"ANALYST_TOOL_INPUT_REJECTED");
});
test("never returns raw sensitive error details", () => {
 const result=classifyAnalystToolError([{type:"text",text:"Secret token abcdef and /Users/person/private/secret"}]);
 assert.equal(result,"ANALYST_TOOL_RETURNED_ERROR");
 assert.equal(classifyAnalystToolError(null),"ANALYST_TOOL_RETURNED_ERROR");
});
