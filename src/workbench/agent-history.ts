import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

export type AgentHistoryKind = "run.started" | "agent.completed" | "agent.reused" | "run.completed" | "run.failed";
export interface AgentHistoryEntry {
  sequence: number;
  timestamp: string;
  jobId: string;
  kind: AgentHistoryKind;
  agentId?: string;
  elapsedMs?: number;
}
const validId = (s: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(s);
const agentIds = new Set(["discovery", "evidence", "mapping", "composition", "quality"]);
const kinds = new Set<AgentHistoryKind>(["run.started", "agent.completed", "agent.reused", "run.completed", "run.failed"]);

/** Atomic, single-process, bounded metadata-only journal. Never stores handler payloads. */
export class AgentHistoryStore {
  private readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    if (!directory.trim()) throw new Error("History directory required");
    this.file = join(resolve(directory), "agent-history.json");
  }
  async list(jobId?: string): Promise<AgentHistoryEntry[]> {
    if (jobId !== undefined && !validId(jobId)) throw new Error("Invalid job ID");
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    if (!Array.isArray(data) || data.length > 2000) throw new Error("Invalid agent history");
    let last = 0;
    for (const item of data) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid agent history");
      const e = item as Record<string, unknown>;
      if (!Number.isSafeInteger(e.sequence) || (e.sequence as number) <= last ||
          typeof e.timestamp !== "string" || !Number.isFinite(Date.parse(e.timestamp)) ||
          typeof e.jobId !== "string" || !validId(e.jobId) ||
          !kinds.has(e.kind as AgentHistoryKind) ||
          (e.agentId !== undefined && (typeof e.agentId !== "string" || !agentIds.has(e.agentId))) ||
          (e.elapsedMs !== undefined && (typeof e.elapsedMs !== "number" || !Number.isFinite(e.elapsedMs) || e.elapsedMs < 0))) {
        throw new Error("Invalid agent history");
      }
      last = e.sequence as number;
    }
    return (data as AgentHistoryEntry[]).filter(e => jobId === undefined || e.jobId === jobId).map(e => ({ ...e }));
  }
  append(entry: Omit<AgentHistoryEntry, "sequence" | "timestamp">): Promise<AgentHistoryEntry> {
    if (!validId(entry.jobId) || !kinds.has(entry.kind) ||
        (entry.agentId !== undefined && !agentIds.has(entry.agentId)) ||
        (entry.elapsedMs !== undefined && (!Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0))) {
      return Promise.reject(new Error("Invalid history entry"));
    }
    const task = this.pending.then(async () => {
      const all = await this.list();
      const record: AgentHistoryEntry = {
        ...entry, sequence: (all.at(-1)?.sequence ?? 0) + 1, timestamp: new Date().toISOString(),
      };
      const next = [...all, record].slice(-1000);
      await mkdir(resolve(this.file, ".."), { recursive: true, mode: 0o700 });
      const temp = this.file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, JSON.stringify(next) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temp, this.file);
      } finally {
        const { rm } = await import("node:fs/promises");
        await rm(temp, { force: true });
      }
      return record;
    });
    this.pending = task.catch(() => undefined);
    return task;
  }
}
