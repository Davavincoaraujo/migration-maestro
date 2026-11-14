import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLegacyEvidence, type LegacyEvidence } from "../src/analysis/legacy-evidence.js";
const sample: LegacyEvidence = {
  schemaVersion: 1, pageId: "demo", capturedAt: "2026-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 720 },
  structure: { sections: 2, headings: 3, links: 4, images: 1 },
  checks: { titlePresent: true, descriptionPresent: false, hasH1: true, brokenLinks: 0 },
};
test("produces privacy-safe evidence findings", () => {
  const report = analyzeLegacyEvidence(sample);
  assert.equal(report.readyForReview, true);
  assert.deepEqual(report.findings.map(f => f.code), ["missing-description"]);
  assert.equal(report.digest.length, 64);
  assert.equal(report.containsScreenshot, false);
});
test("blocks broken links", () => {
  assert.equal(analyzeLegacyEvidence({ ...sample, checks: { ...sample.checks, brokenLinks: 2 } }).readyForReview, false);
});
test("rejects invalid lighthouse scores", () => {
  assert.throws(() => analyzeLegacyEvidence({ ...sample, lighthouse: { performance: 101, accessibility: 90, seo: 90, bestPractices: 90 } }), /Invalid legacy evidence/);
});
