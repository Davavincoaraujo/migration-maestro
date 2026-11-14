import { readdir, readFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { buildMetadataCatalog } from "./adapters/metadata-catalog.js";

async function main(): Promise<void> {
  const [inputDir, outputFile] = process.argv.slice(2);
  if (!inputDir || !outputFile) throw new Error("Usage: npm run metadata:catalog -- <input-dir> <output.json>");
  const root = resolve(inputDir), target = resolve(outputFile);
  if (target === root || target.startsWith(root + "/")) throw new Error("Output must be outside input directory");
  const entries = (await readdir(root)).filter(name => name.endsWith(".json")).sort();
  if (entries.length > 10000) throw new Error("Too many input files");
  const inputs: unknown[] = [];
  for (const name of entries) {
    const file = join(root, name);
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size > 1024 * 1024) throw new Error("Invalid input file: " + name);
    inputs.push(JSON.parse(await readFile(file, "utf8")) as unknown);
  }
  const catalog = buildMetadataCatalog(inputs);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(catalog, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(`Catalog generated: ${catalog.summary.components} components, ${catalog.summary.collections} collections.\n`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
