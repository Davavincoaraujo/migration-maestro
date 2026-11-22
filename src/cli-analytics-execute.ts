import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseSpecification } from "./analytics/specification.js";
import { executeAnalyticsLocally } from "./analytics/local-executor.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: npm run analytics:execute -- <specification.json> <output-directory>");
  process.exitCode = 1;
} else {
  try {
    const spec = parseSpecification(JSON.parse(await readFile(resolve(input), "utf8")) as unknown);
    const dir = resolve(output);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const report = await executeAnalyticsLocally(spec, join(dir, "analytics-checkpoints"), (req, agent, stage) => {
      console.log(req + ": " + agent + " (" + stage + ")");
    });
    const pending = join(dir, "analytics-execution.pending.json");
    await writeFile(pending, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    await rename(pending, join(dir, "analytics-execution.json"));
    console.log("Local synthetic analytics execution awaiting human review.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Execution failed");
    process.exitCode = 1;
  }
}
