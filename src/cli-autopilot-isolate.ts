import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { uePatternConfig } from "./integrations/local-ue-pattern.js";
import { createIsolatedWorktree } from "./integrations/autopilot-isolated-worktree.js";
const [componentPath, packetFile, flag, ...extra] = process.argv.slice(2);
if (!componentPath || !packetFile || flag !== "--create-isolated-worktree" || extra.length) {
 process.stderr.write("Uso: npm run autopilot:isolate -- caminho/do/componente ./local-output/task-packet-1.json --create-isolated-worktree\n");
 process.exitCode = 1;
} else {
 try {
  const config = uePatternConfig();
  if (!config) throw new Error("LOCAL_CONFIG_UNAVAILABLE");
  const info = await stat(resolve(packetFile));
  if (!info.isFile() || info.size > 16000) throw new Error("INVALID_TASK_FILE");
  const packet = JSON.parse(await readFile(resolve(packetFile), "utf8"));
  await mkdir("./local-output", { recursive: true, mode: 0o700 });
  const result = await createIsolatedWorktree(config, componentPath, packet, "./local-output");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
 } catch (error) {
  const msg = error instanceof Error ? error.message : "";
  process.stderr.write("Isolamento bloqueado: " + (/^[A-Z_]+$/.test(msg) ? msg : "ISOLATION_FAILED") + "\n");
  process.exitCode = 2;
 }
}
