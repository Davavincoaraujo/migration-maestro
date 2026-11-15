import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validatePageInputs } from "./integrations/hermes-batch-planner.js";
import { resumeHermesBatch } from "./integrations/hermes-checkpoint-runner.js";

const [file, checkpointDir, ...extra] = process.argv.slice(2);
if (!file || !checkpointDir || extra.length) {
  console.error("Uso: npm run hermes:batch-resume -- ./pages.json ./.maestro-checkpoints");
  process.exitCode = 1;
} else {
  try {
    const inputPath = resolve(file);
    const info = await stat(inputPath);
    if (!info.isFile() || info.size > 8192) throw Error("INVALID_INPUT");
    const pages = validatePageInputs(JSON.parse(await readFile(inputPath, "utf8")));
    const result = await resumeHermesBatch(pages, checkpointDir);
    const { checkpointDirectory: _localPath, ...safeResult } = result;
    console.log(JSON.stringify(safeResult, null, 2));
    if (result.reviewRequired) process.exitCode = 1;
  } catch (error) {
    const reason = error instanceof Error && error.message === "BATCH_ALREADY_RUNNING"
      ? "BATCH_ALREADY_RUNNING" : "HERMES_BATCH_RESUME_FAILED";
    console.error(reason);
    process.exitCode = 1;
  }
}
