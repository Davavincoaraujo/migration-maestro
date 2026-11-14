import test from "node:test";
import assert from "node:assert/strict";
import { collectAuthorizedEvidence } from "../src/analysis/browser-evidence-adapter.js";
import type { LegacyEvidence } from "../src/analysis/legacy-evidence.js";
const sample: LegacyEvidence = {
  schemaVersion: 1, pageId: "demo", capturedAt: "2026-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 720 },
  structure: { sections: 1, headings: 1, links: 0, images: 0 },
  checks: { titlePresent: true, descriptionPresent: true, hasH1: true, brokenLinks: 0 },
};
test("requires explicit exact HTTPS origin before driver invocation", async () => {
  let calls = 0;
  const driver = { collect: async () => { calls++; return sample; } };
  const options = { allowedOrigins: ["https://example.org"], timeoutMs: 1000 };
  await assert.rejects(collectAuthorizedEvidence("https://evil.example.org/", "demo", driver, options), /not authorized/);
  assert.equal(calls, 0);
  const report = await collectAuthorizedEvidence("https://example.org/page", "demo", driver, options);
  assert.equal(report.readyForReview, true);
  assert.equal(calls, 1);
});
test("rejects insecure and credentialed URLs", async () => {
  const driver = { collect: async () => sample };
  const options = { allowedOrigins: ["https://example.org"], timeoutMs: 1000 };
  await assert.rejects(collectAuthorizedEvidence("http://example.org/", "demo", driver, options), /not allowed/);
  await assert.rejects(collectAuthorizedEvidence("https://user:pass@example.org/", "demo", driver, options), /not allowed/);
});
