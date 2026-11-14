import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareLocalHandoff } from "./integrations/autopilot-local-handoff.js";
import { uePatternConfig } from "./integrations/local-ue-pattern.js";
const [componentPath, packetFile, ...extra] = process.argv.slice(2);
if (!componentPath || !packetFile || extra.length || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(componentPath)) {
  process.stderr.write("Uso: npm run autopilot:handoff -- principal/sections/banner-service/v1 ./local-input/task-packet.json\n");
  process.exitCode = 1;
} else {
  try {
    const config = uePatternConfig();
    if (!config) throw new Error("LOCAL_CONFIG_UNAVAILABLE");
    const info = await stat(resolve(packetFile));
    if (!info.isFile() || info.size > 16000) throw new Error("INVALID_TASK_FILE");
    const packet = JSON.parse(await readFile(resolve(packetFile), "utf8"));
    await mkdir("./local-output", { recursive: true, mode: 0o700 });
    const result = await prepareLocalHandoff(config, componentPath, packet, "./local-output");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Handoff bloqueado: " + (/^[A-Z_]+$/.test(message) ? message : "HANDOFF_FAILED") + "\n");
    process.exitCode = 2;
  }
}
