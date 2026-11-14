import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Checkpoint, CheckpointStore } from "./checkpoint-runner.js";

const idPattern = /^[a-f0-9]{20}$/;
function validate(value: unknown, id: string): asserts value is Checkpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid checkpoint");
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || item.jobId !== id || !idPattern.test(id) ||
      typeof item.inputDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.inputDigest) ||
      !["running", "awaiting-review", "failed"].includes(String(item.state)) ||
      !Array.isArray(item.completed) || item.completed.length > 30 ||
      item.completed.some(s => typeof s !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(s)) ||
      new Set(item.completed).size !== item.completed.length ||
      !item.outputs || typeof item.outputs !== "object" || Array.isArray(item.outputs) ||
      Object.keys(item.outputs).some(k => !(item.completed as string[]).includes(k))) throw new Error("Invalid checkpoint");
}
/** Atomic, single-process JSON checkpoint storage; not a distributed lease store. */
export class FileCheckpointStore implements CheckpointStore {
  private readonly directory: string;
  constructor(directory: string) {
    if (!directory.trim()) throw new Error("Checkpoint directory required");
    this.directory = resolve(directory);
  }
  private file(id: string): string {
    if (!idPattern.test(id)) throw new Error("Invalid checkpoint ID");
    return join(this.directory, id + ".checkpoint.json");
  }
  async get(id: string): Promise<Checkpoint | undefined> {
    const file = this.file(id);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 5_000_000) throw new Error("Invalid checkpoint file");
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      validate(parsed, id);
      return structuredClone(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  async put(checkpoint: Checkpoint): Promise<void> {
    validate(checkpoint, checkpoint.jobId);
    const serialized = JSON.stringify(checkpoint);
    if (serialized.length > 5_000_000) throw new Error("Checkpoint too large");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, "." + checkpoint.jobId + "." + randomUUID() + ".tmp");
    try {
      await writeFile(temporary, serialized + "\n", { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file(checkpoint.jobId));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
