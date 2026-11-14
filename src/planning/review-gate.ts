import { createHash } from "node:crypto";
import type { DryRunResult } from "./transform-dry-run.js";

export interface ReviewRequest {
  id: string;
  digest: string;
  status: "pending" | "approved" | "rejected";
  preview: DryRunResult;
  reviewedBy?: string;
  reviewedAt?: string;
}
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createReviewRequest(id: string, preview: DryRunResult): ReviewRequest {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid review ID");
  if (preview.status !== "review-required" || preview.publishable !== false || preview.findings.length) throw new Error("Preview cannot be reviewed");
  return { id, digest: digest(preview), status: "pending", preview: structuredClone(preview) };
}
/** Approval records a decision only; it does not grant AEM publishing permission. */
export function decideReview(request: ReviewRequest, decision: "approved" | "rejected", reviewer: string, currentPreview: DryRunResult, at: string): ReviewRequest {
  if (request.status !== "pending") throw new Error("Review already decided");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(reviewer)) throw new Error("Invalid reviewer");
  if (Number.isNaN(Date.parse(at))) throw new Error("Invalid timestamp");
  if (digest(currentPreview) !== request.digest || digest(request.preview) !== request.digest) throw new Error("Preview changed since review request");
  return { ...request, status: decision, reviewedBy: reviewer, reviewedAt: at };
}
