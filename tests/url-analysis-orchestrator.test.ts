import test from "node:test";
import assert from "node:assert/strict";
import { validatePageUrl, selectUrlAnalysisTool } from "../src/integrations/url-analysis-orchestrator.js";
test("accepts public HTTPS URL", () => assert.equal(validatePageUrl("https://example.com/page"), "https://example.com/page"));
test("rejects local addresses and embedded credentials", () => {
 for (const url of ["http://localhost:3000", "http://127.0.0.1/a", "http://192.168.1.10", "https://user:pass@example.com", "file:///etc/passwd"]) assert.throws(() => validatePageUrl(url));
});
test("uses supported analyst URL parameter and rejects unknown required fields", () => {
 assert.deepEqual(selectUrlAnalysisTool([{ name: "inspect_legacy_source", inputSchema: { properties: { url: {} }, required: ["url"] } }]), { name: "inspect_legacy_source", key: "url" });
 assert.equal(selectUrlAnalysisTool([{ name: "inspect_legacy_source", inputSchema: { properties: { url: {}, secret: {} }, required: ["url", "secret"] } }]), null);
});
