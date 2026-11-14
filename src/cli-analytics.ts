import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseSpecification, buildArtifacts } from "./analytics/specification.js";
import { planAnalyticsHandoff } from "./analytics/autopilot-handoff.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: npm run analytics -- <specification.json> <output-directory>");
  process.exitCode = 1;
} else {
  try {
    const raw: unknown = JSON.parse(await readFile(resolve(input), "utf8"));
    const spec = parseSpecification(raw);
    const artifacts = buildArtifacts(spec);
    const handoff = planAnalyticsHandoff(spec);
    const dir = resolve(output);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "requirements.json"), JSON.stringify(spec, null, 2) + "\n", { flag: "w" });
    await writeFile(join(dir, "traceability.json"), JSON.stringify(artifacts.traceability, null, 2) + "\n", { flag: "w" });
    await writeFile(join(dir, "autopilot-handoff.json"), JSON.stringify(handoff, null, 2) + "\n", { flag: "w" });
    for (const [kind, diagram] of Object.entries(artifacts.diagrams)) {
      await writeFile(join(dir, kind + ".mmd"), diagram + "\n", { flag: "w" });
    }
    console.log("Analytics artifacts generated locally in " + dir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Analytics generation failed");
    process.exitCode = 1;
  }
}
