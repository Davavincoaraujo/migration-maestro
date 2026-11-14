import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runLocalWorkbench } from "./workbench/local-workbench.js";
import { renderWorkbenchHtml } from "./workbench/report-html.js";
import type { EvidenceBatchJob } from "./pipeline/evidence-batch.js";

async function main(): Promise<void> {
  const [inputFile, outputDirectory = ".local-maestro/workbench"] = process.argv.slice(2);
  if (!inputFile) throw new Error("Usage: npm run workbench -- <synthetic-jobs.json> [output-directory]");
  const input = JSON.parse(await readFile(resolve(inputFile), "utf8")) as unknown;
  if (!Array.isArray(input) || input.length > 100 || input.some(x => !x || typeof x !== "object")) throw new Error("Invalid workbench jobs");
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const report = await runLocalWorkbench(input as EvidenceBatchJob[], resolve(directory, "checkpoints"), { concurrency: 2, maxJobs: 100 });
  await Promise.all([
    writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }),
    writeFile(resolve(directory, "index.html"), renderWorkbenchHtml(report), { mode: 0o600 }),
  ]);
  process.stdout.write(JSON.stringify({ output: directory, summary: report.summary }) + "\n");
  if (report.summary.failed || report.summary.cancelled) process.exitCode = 1;
}
main().catch(() => { console.error("Workbench failed; verify synthetic input and local permissions."); process.exitCode = 1; });
