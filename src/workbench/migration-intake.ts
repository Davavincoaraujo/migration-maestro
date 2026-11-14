import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { defaultMigrationAgents, planLocalAgentGraph } from "../orchestration/agent-graph.js";

export interface MigrationIntake { id: string; source: string; destination: string; status: "planned"; createdAt: string; }
const validPath = /^\/content\/[a-zA-Z0-9_/-]{1,240}$/;
export function validateMigrationInput(source: string, destination: string): { source: string; destination: string } {
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local") ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(url.hostname) ||
      /^\[/.test(url.hostname) || url.port || source.length > 500) throw new Error("Invalid source");
  if (!validPath.test(destination) || destination.includes("//") || destination.split("/").includes("..")) throw new Error("Invalid destination");
  return { source: url.toString(), destination };
}
export async function listMigrationIntakes(directory: string): Promise<MigrationIntake[]> {
  try {
    const value: unknown = JSON.parse(await readFile(join(directory, "migration-intakes.json"), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is MigrationIntake => Boolean(item) && typeof item === "object" &&
      typeof item.id === "string" && typeof item.source === "string" &&
      typeof item.destination === "string" && item.status === "planned" && typeof item.createdAt === "string").slice(-100);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function createMigrationIntake(directory: string, source: string, destination: string): Promise<MigrationIntake> {
  const input = validateMigrationInput(source, destination);
  const existing = await listMigrationIntakes(directory);
  if (existing.length >= 100) throw new Error("Migration intake limit reached");
  const entry: MigrationIntake = { id: randomUUID(), ...input, status: "planned", createdAt: new Date().toISOString() };
  const path = join(directory, "migration-intakes.json");
  const temporary = join(directory, "migration-intakes.pending.json");
  await writeFile(temporary, JSON.stringify([...existing, entry], null, 2), { mode: 0o600 });
  await rename(temporary, path);
  return entry;
}
export function migrationPlanSteps(): readonly string[] {
  return planLocalAgentGraph(defaultMigrationAgents).executionOrder;
}
