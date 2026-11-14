import { createHash } from "node:crypto";

export interface LegacyEvidence {
  schemaVersion: 1;
  pageId: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  structure: { sections: number; headings: number; links: number; images: number };
  checks: { titlePresent: boolean; descriptionPresent: boolean; hasH1: boolean; brokenLinks: number };
  lighthouse?: { performance: number; accessibility: number; seo: number; bestPractices: number };
  screenshotDigest?: string;
}
export interface EvidenceFinding { code: string; severity: "warning" | "error"; }
export interface EvidenceReport {
  pageId: string;
  digest: string;
  findings: EvidenceFinding[];
  readyForReview: boolean;
  containsScreenshot: false;
}
export function analyzeLegacyEvidence(evidence: LegacyEvidence): EvidenceReport {
  if (!evidence || evidence.schemaVersion !== 1 ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(evidence.pageId) ||
      !Number.isFinite(Date.parse(evidence.capturedAt)) ||
      !Number.isSafeInteger(evidence.viewport?.width) || evidence.viewport.width < 320 || evidence.viewport.width > 10000 ||
      !Number.isSafeInteger(evidence.viewport?.height) || evidence.viewport.height < 240 || evidence.viewport.height > 10000 ||
      !evidence.structure || !evidence.checks ||
      ![evidence.structure.sections, evidence.structure.headings, evidence.structure.links, evidence.structure.images, evidence.checks.brokenLinks]
        .every(n => Number.isSafeInteger(n) && n >= 0) ||
      ![evidence.checks.titlePresent, evidence.checks.descriptionPresent, evidence.checks.hasH1].every(x => typeof x === "boolean") ||
      (evidence.screenshotDigest !== undefined && !/^[a-f0-9]{64}$/.test(evidence.screenshotDigest)) ||
      (evidence.lighthouse !== undefined &&
        !Object.values(evidence.lighthouse).every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100))) {
    throw new Error("Invalid legacy evidence");
  }
  const findings: EvidenceFinding[] = [];
  if (!evidence.checks.titlePresent) findings.push({ code: "missing-title", severity: "warning" });
  if (!evidence.checks.descriptionPresent) findings.push({ code: "missing-description", severity: "warning" });
  if (!evidence.checks.hasH1) findings.push({ code: "missing-h1", severity: "warning" });
  if (evidence.checks.brokenLinks > 0) findings.push({ code: "broken-links", severity: "error" });
  if (evidence.lighthouse && evidence.lighthouse.accessibility < 80) findings.push({ code: "accessibility-baseline-low", severity: "warning" });
  const digest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  return { pageId: evidence.pageId, digest, findings, readyForReview: findings.every(f => f.severity !== "error"), containsScreenshot: false };
}
