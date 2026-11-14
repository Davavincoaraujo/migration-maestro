import type { LegacyPage, MigratedPage } from "../types.js";
/** Adapters are interfaces only: no external network calls in this prototype. */
export interface LegacySourceAdapter {
  listPaths(): Promise<string[]>;
  readPage(path: string): Promise<LegacyPage>;
}
export interface TargetPreviewAdapter {
  preview(page: MigratedPage): Promise<{ previewId: string; diff: string }>;
}
export interface ApprovalGateway {
  requestReview(input: { jobId: string; summary: string }): Promise<{ reviewUrl: string }>;
  isApproved(jobId: string): Promise<boolean>;
}
export interface PublishingGateway {
  publish(page: MigratedPage, approvalReference: string): Promise<{ publishedPath: string }>;
}
/** No implementation is wired to publishing; human approval is mandatory. */
