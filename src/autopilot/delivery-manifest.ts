import { readFile, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { artifactDigest } from "./central-controller.js";
import type { Checkpoint } from "./checkpoint-runner.js";
import { sha256 } from "../integrations/aem-create-only.js";

/** Deterministic review bundle. Never commits, pushes, creates a PR or publishes. */
export async function writeDeliveryManifest(options: { root: string; project: string; checkpoint: Checkpoint; files: string[] }) {
  if (options.checkpoint.state !== "awaiting-review") throw Error("DELIVERY_REVIEW_CHECKPOINT_REQUIRED");
  const artifacts = [];
  for (const [stage, value] of Object.entries(options.checkpoint.outputs)) {
    for (const ref of (value as { artifacts?: { file: string; digest: string }[] }).artifacts ?? []) {
      if (await artifactDigest(options.root, ref.file) !== ref.digest) throw Error("DELIVERY_ARTIFACT_CHANGED");
      artifacts.push({ stage, ...ref });
    }
  }
  const files = [];
  for (const file of [...new Set(options.files)].sort()) {
    if (!/^(?:src|scripts\/maestro)\/[a-zA-Z0-9_./@-]+$/.test(file) || file.split("/").some(p => [".", ".."].includes(p))) throw Error("DELIVERY_FILE_OUTSIDE_SCOPE");
    const path = await realpath(join(options.project, file));
    if (!path.startsWith(await realpath(options.project) + "/")) throw Error("DELIVERY_FILE_OUTSIDE_SCOPE");
    files.push({ file, digest: sha256(await readFile(path)) });
  }
  let checks: { name: string; status: string }[] = [];
  try { checks = JSON.parse(await readFile(join(options.root, "validation.json"), "utf8")).checks; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const report = { version: 1, jobId: options.checkpoint.jobId, state: "awaiting-human-review", completed: options.checkpoint.completed, inputDigest: options.checkpoint.inputDigest,
    files, artifacts, independentChecks: checks, allDeclaredChecksPassed: checks.length > 0 && checks.every(c => c.status === "passed"), acceptanceVerified: false, humanApprovalRequired: true,
    productionPublished: false, mergeAuthorized: false, gitOperationsPerformed: [], limitations: ["Review bundle does not authorize AEM writes, Git push/PR, merge or publishing.", "Agent assertions alone are not browser or visual acceptance proof."] };
  const bytes = JSON.stringify(report, null, 2);
  const file = join(options.root, "delivery-manifest.json");
  try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (await readFile(file, "utf8") !== bytes) throw Error("DELIVERY_MANIFEST_CHANGED");
  }
  return report;
}
