import { createHash } from "node:crypto";
import { discoveryAgent, transformationAgent, validationAgent } from "../agents.js";
import type { LegacyPage, MigrationResult, Stage } from "../types.js";

export type JobState = "queued" | "running" | "awaiting-review" | "failed";
export interface JobEvent { at: string; stage: Stage; detail: string; }
export interface JobRecord {
  id: string;
  state: JobState;
  sourcePath: string;
  events: JobEvent[];
  result?: MigrationResult;
  error?: string;
}
export interface JobStore {
  get(id: string): Promise<JobRecord | undefined>;
  put(record: JobRecord): Promise<void>;
}
export class MemoryJobStore implements JobStore {
  private readonly records = new Map<string, JobRecord>();
  async get(id: string) { return this.records.get(id); }
  async put(record: JobRecord) { this.records.set(record.id, structuredClone(record)); }
}
export function jobId(page: LegacyPage): string {
  return createHash("sha256").update(JSON.stringify([page.path, page.title, page.body])).digest("hex").slice(0, 20);
}
export interface AutopilotConfig { maxPages: number; retryLimit: number; }
export const defaultConfig: AutopilotConfig = { maxPages: 10, retryLimit: 2 };
export class Autopilot {
  constructor(private readonly store: JobStore, private readonly config: AutopilotConfig = defaultConfig) {
    if (!Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 100) throw new Error("Invalid maxPages");
    if (!Number.isInteger(config.retryLimit) || config.retryLimit < 0 || config.retryLimit > 5) throw new Error("Invalid retryLimit");
  }
  async run(pages: LegacyPage[]): Promise<JobRecord[]> {
    const results: JobRecord[] = [];
    for (const page of pages.slice(0, this.config.maxPages)) {
      const id = jobId(page);
      const existing = await this.store.get(id);
      if (existing?.state === "awaiting-review") { results.push(existing); continue; }
      const record: JobRecord = { id, sourcePath: page.path, state: "queued", events: [] };
      const event = (stage: Stage, detail: string) => record.events.push({ at: new Date().toISOString(), stage, detail });
      for (let attempt = 0; attempt <= this.config.retryLimit; attempt++) {
        try {
          record.state = "running";
          event("discover", "Discover source");
          const source = await discoveryAgent.run(page);
          event("transform", "Build generic target model");
          const target = await transformationAgent.run(source);
          event("validate", "Validate target");
          const findings = await validationAgent.run(target);
          record.result = { source, target, findings, approved: false };
          record.state = findings.some(f => f.level === "error") ? "failed" : "awaiting-review";
          event("review", record.state === "failed" ? "Validation blocked" : "Human approval required");
          record.error = record.state === "failed" ? "Validation failed" : undefined;
          break;
        } catch (error) {
          record.error = error instanceof Error ? error.message : "Unknown failure";
          record.state = "failed";
          event("analyze", `Attempt ${attempt + 1} failed: ${record.error}`);
        }
      }
      await this.store.put(record);
      results.push(record);
    }
    return results;
  }
}
