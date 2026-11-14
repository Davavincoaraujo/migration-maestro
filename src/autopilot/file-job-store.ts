import { mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { JobRecord, JobStore } from "./job.js";

const validId = (id: string): boolean => /^[a-f0-9]{20}$/.test(id);
function validate(record: JobRecord, id: string): void {
  if (!record || typeof record.id !== "string" || !validId(record.id) || !validId(id)) {
    throw new Error("Invalid job identifier");
  }
  if (record.id !== id ||
      !["queued", "running", "awaiting-review", "failed"].includes(record.state) ||
      typeof record.sourcePath !== "string" || !Array.isArray(record.events)) {
    throw new Error("Invalid persisted job record");
  }
}
/** Single-process file store. Stores job content; only use in an approved local environment. */
export class FileJobStore implements JobStore {
  private readonly root: string;
  constructor(directory: string) {
    if (!directory.trim()) throw new Error("Job directory required");
    this.root = resolve(directory);
  }
  private path(id: string): string {
    if (!validId(id)) throw new Error("Invalid job identifier");
    return join(this.root, id + ".json");
  }
  async get(id: string): Promise<JobRecord | undefined> {
    const path = this.path(id);
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.size > 5_000_000) throw new Error("Invalid job file");
      const record = JSON.parse(await readFile(path, "utf8")) as JobRecord;
      validate(record, id);
      return structuredClone(record);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  async put(record: JobRecord): Promise<void> {
    validate(record, record.id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const destination = this.path(record.id);
    const temp = join(this.root, "." + record.id + "." + randomUUID() + ".tmp");
    try {
      await writeFile(temp, JSON.stringify(record) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temp, destination);
    } finally {
      await rm(temp, { force: true });
    }
  }
}
