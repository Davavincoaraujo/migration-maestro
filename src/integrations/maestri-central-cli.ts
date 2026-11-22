import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";

export type MaestriCommand = "list" | "ask" | "check";
export type MaestriTransport = (command: MaestriCommand, args: string[]) => Promise<string>;

export class MaestriCommandError extends Error {
  constructor(
    readonly command: MaestriCommand,
    readonly exitCode: number | null,
    readonly stderrClass: "permission-denied" | "empty" | "other",
    code: string,
  ) {
    super(code);
    this.name = "MaestriCommandError";
  }
}

/** Official CLI only; socket discovery belongs to Maestri. Never bypasses sandbox policy. */
export function maestriTransport(executable = process.env.MAESTRI_CLI || "maestri", timeoutMs = 30000): MaestriTransport {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw Error("INVALID_TIMEOUT");
  return (command, args) => new Promise((resolve, reject) => {
    const child = spawn(executable, [command, ...args], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const decoder = new StringDecoder("utf8");
    let output = "", stderr = "", size = 0, settled = false;
    const finish = (error?: string, exitCode: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        const text = stderr.trim();
        const stderrClass = /operation not permitted|permission denied|\bEPERM\b/i.test(text)
          ? "permission-denied"
          : text ? "other" : "empty";
        reject(new MaestriCommandError(command, exitCode, stderrClass, error));
      } else resolve(output + decoder.end());
    };
    const timer = setTimeout(() => finish("MAESTRI_TIMEOUT"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128000) finish("MAESTRI_OUTPUT_LIMIT"); else output += decoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (stderr.length < 4096) stderr += chunk.toString("utf8", 0, Math.min(chunk.length, 4096 - stderr.length));
      if (size > 128000) finish("MAESTRI_OUTPUT_LIMIT");
    });
    child.on("error", () => finish("MAESTRI_UNAVAILABLE"));
    child.on("close", code => finish(code === 0 ? undefined : "MAESTRI_COMMAND_FAILED", code));
  });
}
