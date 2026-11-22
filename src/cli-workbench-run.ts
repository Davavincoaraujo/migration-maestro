import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runLocalWorkbench } from "./workbench/local-workbench.js";
import type { EvidenceBatchJob } from "./pipeline/evidence-batch.js";

/** Deterministic local fixture runner. Emits metadata JSON only; no HTML or server. */
async function main(): Promise<void> {
  const [inputFile, outputDirectory = ".local-maestro/workbench"] = process.argv.slice(2);
  if (!inputFile) throw new Error("Usage: npm run workbench:run -- <synthetic-jobs.json> [output-directory]");
  const input = JSON.parse(await readFile(resolve(inputFile), "utf8")) as unknown;
  if (!Array.isArray(input) || input.length > 100 || input.some(x => !x || typeof x !== "object")) throw new Error("Invalid workbench jobs");
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = await runLocalWorkbench(input as EvidenceBatchJob[], resolve(directory, "checkpoints"), { concurrency: 2, maxJobs: 100 });
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ output: directory, summary: report.summary }) + "\n");
  if (report.summary.failed || report.summary.cancelled) process.exitCode = 1;
}
main().catch(() => { console.error("Synthetic run failed; verify input and local permissions."); process.exitCode = 1; });
