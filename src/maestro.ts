import { discoveryAgent, transformationAgent, validationAgent } from "./agents.js";
import type { LegacyPage, MigrationResult } from "./types.js";
export interface MaestroOptions { autopilot?: boolean; maxPages?: number; }
export async function runMaestro(pages: LegacyPage[], options: MaestroOptions = {}): Promise<MigrationResult[]> {
  const maxPages = options.maxPages ?? 10;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("maxPages must be between 1 and 100");
  const results: MigrationResult[] = [];
  for (const source of pages.slice(0, maxPages)) {
    const discovered = await discoveryAgent.run(source);
    const target = await transformationAgent.run(discovered);
    const findings = await validationAgent.run(target);
    // Autopilot runs local migration steps, never approves or publishes.
    results.push({ source, target, findings, approved: false });
    if (!options.autopilot) break;
  }
  return results;
}
