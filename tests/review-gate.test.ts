import test from "node:test";
import assert from "node:assert/strict";
import { createReviewRequest, decideReview } from "../src/planning/review-gate.js";
import { dryRunTransform } from "../src/planning/transform-dry-run.js";
const preview = dryRunTransform({ schemaVersion: 1, mappingId: "demo", fields: [{ source: "name", target: "title", kind: "text", required: true }] }, { name: "Example" });
test("records approval without publishing", () => {
  const request = createReviewRequest("review_1", preview);
  const decided = decideReview(request, "approved", "reviewer_1", preview, "2026-11-14T00:00:00Z");
  assert.equal(decided.status, "approved");
  assert.equal(decided.preview.publishable, false);
});
test("rejects stale preview and repeated decisions", () => {
  const request = createReviewRequest("review_2", preview);
  const changed = { ...preview, preview: { title: "Different" } };
  assert.throws(() => decideReview(request, "approved", "reviewer_1", changed, "2026-11-14T00:00:00Z"), /changed/);
  const decided = decideReview(request, "rejected", "reviewer_1", preview, "2026-11-14T00:00:00Z");
  assert.throws(() => decideReview(decided, "approved", "reviewer_2", preview, "2026-11-14T00:00:00Z"), /already decided/);
});
test("blocks invalid previews", () => {
  const blocked = { ...preview, status: "blocked" as const };
  assert.throws(() => createReviewRequest("review_3", blocked), /cannot be reviewed/);
});
