import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recordReview, reviewDigest, readReviewLedger } from "./workbench/review-ledger.js";
import type { WorkbenchReport } from "./workbench/local-workbench.js";

async function main(): Promise<void> {
  const [command, jobId, reviewer, digest] = process.argv.slice(2);
  const report = JSON.parse(await readFile(resolve(".local-maestro/workbench/report.json"), "utf8")) as WorkbenchReport;
  const path = resolve(".local-maestro/workbench/reviews.json");
  if (command === "list") {
    console.log(JSON.stringify(await readReviewLedger(path), null, 2));
  } else if (command === "digest" && jobId) {
    console.log(reviewDigest(report, jobId));
  } else if ((command === "approve" || command === "reject") && jobId && reviewer && digest) {
    console.log(JSON.stringify(await recordReview(path, report, jobId, reviewer, command === "approve" ? "approved" : "rejected", digest), null, 2));
  } else throw new Error("Usage: npm run review -- list | digest <jobId> | approve|reject <jobId> <reviewer> <digest>");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Review failed"); process.exitCode = 1; });
