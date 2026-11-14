import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { exportLocalMetadata } from "./adapters/local-metadata.js";
import type { AuthoredDefinition } from "./adapters/container-tree.js";

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error("Usage: npm run metadata:export -- <evaluated-definition.json> <output.json>");
  }
  const source = JSON.parse(await readFile(resolve(input), "utf8")) as AuthoredDefinition;
  const exported = exportLocalMetadata(source);
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(exported, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write("Anonymized metadata written locally. Do not commit proprietary source files.\n");
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
