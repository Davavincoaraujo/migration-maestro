/** Interactive, local-only binding authoring. Never sends catalog identifiers to GitHub. */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan } from "./integrations/component-matching-engine.js";
import { parseBindingManifest, verifyBoundComponent, type Binding } from "./integrations/component-binding-resolver.js";
import { uePatternConfig } from "./integrations/local-ue-pattern.js";
const [query, fileArg = "./local-input/bindings.json", ...extra] = process.argv.slice(2);
if (!query || query.length > 120 || /[\x00-\x1f]/.test(query) || extra.length) {
  process.stderr.write("Uso: npm run analyst:bindings -- banner [./local-input/bindings.json]\n");
  process.exitCode = 1;
} else {
  try {
    const config = uePatternConfig();
    if (!config) throw new Error("LOCAL_CONFIG_UNAVAILABLE");
    const file = resolve(fileArg);
    const localRoot = resolve("./local-input");
    if (file !== resolve(localRoot, "bindings.json")) throw new Error("INVALID_BINDINGS_DESTINATION");
    const catalog = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 5 });
    const candidates = buildMatchingPlan(catalog.content).candidates;
    let existing: Binding[] = [];
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 16000) throw new Error("INVALID_BINDINGS");
      existing = parseBindingManifest(JSON.parse(await readFile(file, "utf8"))).bindings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("INTERACTIVE_TERMINAL_REQUIRED");
    process.stdout.write("Candidatos locais do MCP (não copie estes dados para o GitHub):\n");
    candidates.forEach((c, i) => {
      const linked = existing.some(b => b.catalogId === c.id);
      process.stdout.write(`${i + 1}. ${JSON.stringify({ id: c.id, name: c.name, score: c.score, linked })}\n`);
    });
    if (!candidates.length) throw new Error("NO_CANDIDATES");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const selection = (await rl.question("Número do candidato (Enter cancela): ")).trim();
      if (!selection) { process.stdout.write("Cancelado.\n"); }
      else {
        const index = Number(selection) - 1;
        if (!/^\d+$/.test(selection) || !Number.isSafeInteger(index) || index < 0 || index >= candidates.length) throw new Error("INVALID_SELECTION");
        const candidate = candidates[index];
        const componentPath = (await rl.question("Caminho relativo do componente (ex.: principal/sections/banner-service/v1): ")).trim();
        if (!(await verifyBoundComponent(config, componentPath))) throw new Error("COMPONENT_NOT_VERIFIED");
        const conflicts = existing.filter(b => b.catalogId === candidate.id || b.componentPath === componentPath);
        if (conflicts.length && !conflicts.every(b => b.catalogId === candidate.id && b.componentPath === componentPath)) throw new Error("BINDING_CONFLICT");
        if (conflicts.length) { process.stdout.write("Associação já existente; nenhuma alteração.\n"); }
        else {
          const confirmation = (await rl.question("Confirma que o ID selecionado corresponde ao componente local? Digite CONFIRMAR: ")).trim();
          if (confirmation !== "CONFIRMAR") process.stdout.write("Cancelado.\n");
          else {
            const manifest = parseBindingManifest({ bindings: [...existing, { catalogId: candidate.id, componentPath }] });
            await mkdir(dirname(file), { recursive: true, mode: 0o700 });
            // Exclusive create avoids replacing a manifest changed by another process.
            const temp = file + "." + process.pid + ".tmp";
            try {
              await writeFile(temp, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
              // Recheck the original snapshot before replacement.
              let current = "";
              try { current = await readFile(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
              if (current && JSON.stringify(parseBindingManifest(JSON.parse(current)).bindings) !== JSON.stringify(existing)) throw new Error("BINDINGS_CHANGED");
              await rename(temp, file);
              process.stdout.write("Associação confirmada e salva apenas em local-input/bindings.json.\n");
            } finally {
              const fs = await import("node:fs/promises");
              await fs.rm(temp, { force: true }).catch(() => {});
            }
          }
        }
      }
    } finally { rl.close(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = /^(ANALYST_|INVALID_|EMPTY_|LOCAL_CONFIG_UNAVAILABLE|INTERACTIVE_TERMINAL_REQUIRED|NO_CANDIDATES|COMPONENT_NOT_VERIFIED|BINDING_CONFLICT|BINDINGS_CHANGED)[A-Z_]*$/.test(message);
    process.stderr.write("Falha nas associações: " + (safe ? message : "BINDING_DISCOVERY_FAILED") + "\n");
    process.exitCode = 1;
  }
}
