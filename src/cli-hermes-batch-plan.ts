import { readFile, stat } from "node:fs/promises";
import { planHermesBatch, validatePageInputs } from "./integrations/hermes-batch-planner.js";

const [filename, ...extra] = process.argv.slice(2);
if (!filename || extra.length) {
  console.error("Uso: npm run hermes:batch-plan -- ./pages.json");
  process.exitCode = 1;
} else {
  try {
    const file = await stat(filename);
    if (!file.isFile() || file.size > 8192) throw Error("INVALID_INPUT");
    const pages = validatePageInputs(JSON.parse(await readFile(filename, "utf8")));
    const result = await planHermesBatch(pages);
    console.log(JSON.stringify(result, null, 2));
    if (result.reviewRequired) process.exitCode = 1;
  } catch {
    console.error("HERMES_BATCH_PLAN_FAILED");
    process.exitCode = 1;
  }
}
