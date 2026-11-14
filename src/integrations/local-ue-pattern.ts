/** Local ue-pattern integration: explicit CLI path, read-only commands and no shell. */
import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export interface UePatternConfig { cliDirectory: string; projectDirectory: string; }
export interface UePatternCommandResult { command: "topicos" | "buscar" | "validar"; output: string; }
export function uePatternConfig(env: NodeJS.ProcessEnv = process.env): UePatternConfig | null {
  const cliDirectory = env.MAESTRO_UE_PATTERN_DIR;
  const projectDirectory = env.MAESTRO_COMPONENTS_PROJECT_DIR;
  if (!cliDirectory || !projectDirectory) return null;
  if (!isAbsolute(cliDirectory) || !isAbsolute(projectDirectory)) throw new Error("Absolute local paths required");
  return { cliDirectory, projectDirectory };
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}
export async function verifyUePattern(config: UePatternConfig): Promise<{ cli: string; project: string }> {
  const cliRoot = await realpath(config.cliDirectory).catch(() => { throw new Error("UE_PATTERN_DIRECTORY_NOT_FOUND"); });
  const project = await realpath(config.projectDirectory).catch(() => { throw new Error("COMPONENT_PROJECT_DIRECTORY_NOT_FOUND"); });
  if (!(await stat(cliRoot)).isDirectory() || !(await stat(project)).isDirectory()) throw new Error("Invalid directory");
  const cli = await realpath(join(cliRoot, "dist", "cli.js")).catch(() => { throw new Error("UE_PATTERN_CLI_NOT_BUILT"); });
  if (!inside(cliRoot, cli) || !(await stat(cli)).isFile()) throw new Error("Invalid ue-pattern CLI");
  return { cli, project };
}
export async function runUePatternReadOnly(
  config: UePatternConfig, command: "topicos" | "buscar" | "validar", argument?: string,
): Promise<UePatternCommandResult> {
  const { cli, project } = await verifyUePattern(config);
  if (command === "topicos" && argument !== undefined) throw new Error("Unexpected argument");
  if (command === "buscar" && (!argument || argument.length > 120 || /[\x00-\x1f]/.test(argument))) throw new Error("Invalid search");
  if (command === "validar" && (!argument || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(argument) || argument.length > 180)) throw new Error("Invalid component path");
  const args = [cli, command, ...(argument === undefined ? [] : [argument]), "--projeto", project];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: project, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, UE_PATTERN_PROJECT_PATH: project },
    });
    let output = "";
    let size = 0;
    let stopped = false;
    const stop = (error: Error) => { if (!stopped) { stopped = true; child.kill(); reject(error); } };
    const timeout = setTimeout(() => stop(new Error("ue-pattern timeout")), 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 64_000) { stop(new Error("ue-pattern output limit")); return; }
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 64_000) stop(new Error("ue-pattern output limit"));
    });
    child.on("error", () => stop(new Error("ue-pattern could not start")));
    child.on("close", code => {
      clearTimeout(timeout);
      if (stopped) return;
      if (code !== 0) { reject(new Error("UE_PATTERN_COMMAND_FAILED")); return; }
      resolve({ command, output });
    });
  });
}
