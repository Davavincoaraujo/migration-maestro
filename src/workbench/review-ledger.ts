import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { WorkbenchReport } from "./local-workbench.js";

export interface ReviewEntry {
  jobId: string;
  digest: string;
  decision: "approved" | "rejected";
  reviewer: string;
  decidedAt: string;
}
export interface ReviewLedger { schemaVersion: 1; entries: ReviewEntry[] }
const safe = (value: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function reviewDigest(report: WorkbenchReport, jobId: string): string {
  const job = report.jobs.find(j => j.id === jobId);
  if (!job || job.status !== "review-required" || job.findings.length) throw new Error("Job is not eligible for review");
  return createHash("sha256").update(JSON.stringify({
    id: job.id, status: job.status, stages: job.stages, findings: job.findings, componentCount: job.componentCount,
  })).digest("hex");
}
export async function readReviewLedger(path: string): Promise<ReviewLedger> {
  try {
    const raw = await readFile(resolve(path), "utf8");
    if (raw.length > 1_000_000) throw new Error("Review ledger too large");
    const value = JSON.parse(raw) as ReviewLedger;
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 10000 ||
        value.entries.some(e => !safe(e.jobId) || !safe(e.reviewer) ||
          !/^[a-f0-9]{64}$/.test(e.digest) || !["approved", "rejected"].includes(e.decision) ||
          !Number.isFinite(Date.parse(e.decidedAt)))) throw new Error("Invalid review ledger");
    return value;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { schemaVersion: 1, entries: [] };
    throw error;
  }
}
/** Single-process, offline decision record. Never grants write/publish rights. */
export async function recordReview(
  path: string, report: WorkbenchReport, jobId: string, reviewer: string, decision: "approved" | "rejected",
  expectedDigest: string,
): Promise<ReviewEntry> {
  if (!safe(jobId) || !safe(reviewer) || !["approved", "rejected"].includes(decision)) throw new Error("Invalid review decision");
  const digest = reviewDigest(report, jobId);
  if (digest !== expectedDigest) throw new Error("Review digest mismatch");
  const ledger = await readReviewLedger(path);
  if (ledger.entries.some(e => e.jobId === jobId)) throw new Error("Review already recorded");
  const entry: ReviewEntry = { jobId, reviewer, decision, digest, decidedAt: new Date().toISOString() };
  ledger.entries.push(entry);
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(ledger, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  return entry;
}
