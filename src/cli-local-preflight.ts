import { spawnSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

async function directoryStatus(value: string | undefined): Promise<string> {
  if (!value || !isAbsolute(value)) return "not-configured";
  try {
    const path = await realpath(value);
    return (await stat(path)).isDirectory() ? "ready" : "not-directory";
  } catch { return "not-found-or-inaccessible"; }
}
function cliStatus(name: string): string {
  const result = spawnSync(name, ["--version"], {
    shell: false, stdio: "ignore", timeout: 5000, windowsHide: true,
  });
  return result.error || result.status !== 0 ? "unavailable" : "available";
}
const report = {
  schemaVersion: 1,
  localProjects: {
    analytics: await directoryStatus(process.env.MAESTRO_ANALYTICS_DIR),
    components: await directoryStatus(process.env.MAESTRO_COMPONENTS_PROJECT_DIR),
    uePattern: await directoryStatus(process.env.MAESTRO_UE_PATTERN_DIR),
  },
  executors: { claudeCode: cliStatus("claude"), codex: cliStatus("codex") },
  note: "Local checks only. No repository contents, paths, tokens or source code transmitted.",
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
