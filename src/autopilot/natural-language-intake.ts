import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateMigrationInput } from "../workbench/migration-intake.js";

export type MigrationIntent =
  | { kind: "migrate"; url: string }
  | { kind: "correct-latest" }
  | { kind: "unknown" };

export interface MigrationRecord {
  id: string;
  sourceUrl: string;
  executionConfig?: { project: string; pageRoot: string; damRoot: string; target: string | null; environment?: "non-production"; policy?: { pauseAfter: string | null; dispatchMode: "deferred" | "official" } };
  aemPage: string | null;
  components: string[];
  changedFiles: string[];
  assets: string[];
  errors: string[];
  checkpoints: string[];
  modelChoices: { stage: string; agent: string | null; provider: string | null; model: string | null; evidence: string }[];
  status: string;
  evidenceDirectory: string | null;
  executions?: { jobId: string; kind: "migration" | "correction"; evidenceDirectory: string; status: string; completed: string[]; error?: string }[];
  createdAt: string;
  updatedAt: string;
  correctionRequests: { at: string; outcome: "awaiting-review" | "blocked"; note: string; request?: string }[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;
const PAGE_PATH = /^\/content\/[a-zA-Z0-9_/-]{1,240}$/;

export function parseMigrationIntent(text: string): MigrationIntent {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const correction = /(?:^|[^a-z0-9])(corrija|corrigir|conserte|consertar|fix|repair)(?:$|[^a-z0-9]).*(?:^|[^a-z0-9])(ultima|last|recente?)(?:$|[^a-z0-9])|(?:^|[^a-z0-9])(ultima|last)\s+migracao(?:$|[^a-z0-9])/.test(normalized);
  if (correction) return { kind: "correct-latest" };
  const url = URL_PATTERN.exec(text)?.[0]?.replace(/[),.;!?]+$/g, "");
  const migrate = /(?:^|[^a-z0-9])(migre|migrar|migra|migrate|migration)(?:$|[^a-z0-9])/.test(normalized);
  if ((!migrate && text.trim() !== url) || !url) return { kind: "unknown" };
  try { return { kind: "migrate", url: validateMigrationInput(url, "/content/site/page").source }; }
  catch { throw new Error("INVALID_MIGRATION_URL"); }
}

export async function readMigrationRecords(directory: string): Promise<MigrationRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, "migrations.json"), "utf8"));
    if (!Array.isArray(parsed)) throw new Error("INVALID_MIGRATION_REGISTRY");
    return parsed as MigrationRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function persist(directory: string, records: MigrationRecord[]): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, "migrations.json");
  const temp = join(directory, `migrations.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(records, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temp, target);
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(temp, { force: true });
  }
}

export async function recordMigrationRequest(directory: string, sourceUrl: string): Promise<MigrationRecord> {
  const intent = parseMigrationIntent(`Migre esta URL: ${sourceUrl}`);
  if (intent.kind !== "migrate") throw new Error("INVALID_MIGRATION_URL");
  const records = await readMigrationRecords(directory);
  const existing = records.find(record => record.sourceUrl === intent.url);
  if (existing) return existing;
  const now = new Date().toISOString();
  const record: MigrationRecord = {
    id: randomUUID(), sourceUrl: intent.url, aemPage: null, components: [], changedFiles: [], assets: [], errors: [],
    checkpoints: ["request-received"],
    modelChoices: [{ stage: "intake", agent: null, provider: null, model: null, evidence: "URL parsing and registry lookup are deterministic; no model call." }],
    status: "queued-for-maestri-execution", evidenceDirectory: null, createdAt: now, updatedAt: now, correctionRequests: [],
  };
  records.push(record);
  await persist(directory, records);
  return record;
}

export async function importCompletedLocalPilot(directory: string, reportFile: string, evidenceDirectory: string): Promise<MigrationRecord> {
  const [reportRaw, contextRaw, filesRaw, damRaw, payloadRaw, checkpointRaw] = await Promise.all([
    readFile(reportFile, "utf8"), readFile(join(evidenceDirectory, "run-context.json"), "utf8"),
    readFile(join(evidenceDirectory, "applied-files.json"), "utf8"), readFile(join(evidenceDirectory, "dam-upload-report.json"), "utf8"),
    readFile(join(evidenceDirectory, "page-payload-reviewed.json"), "utf8"),
    readHistoricalCheckpoint(reportFile, evidenceDirectory),
  ]);
  const report = JSON.parse(reportRaw) as Record<string, unknown>;
  const context = JSON.parse(contextRaw) as Record<string, unknown>;
  const files = JSON.parse(filesRaw) as unknown[];
  const dam = JSON.parse(damRaw) as { assets?: unknown[] };
  const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  const checkpoint = JSON.parse(checkpointRaw) as { completed?: unknown[] };
  const sourceUrl = context.source;
  const pagePath = payload.pagePath;
  if (typeof sourceUrl !== "string" || typeof pagePath !== "string" || !PAGE_PATH.test(pagePath) ||
      typeof report.id !== "string" || !Array.isArray(files) || !Array.isArray(dam.assets)) {
    throw new Error("PILOT_REPORT_SCHEMA_MISMATCH");
  }
  const records = await readMigrationRecords(directory);
  const found = records.find(record => record.sourceUrl === sourceUrl);
  if (found) return found;
  const now = new Date().toISOString();
  const resourceTypes: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (typeof obj["sling:resourceType"] === "string") resourceTypes.push(obj["sling:resourceType"]);
    Object.values(obj).forEach(visit);
  };
  visit(payload.page);
  const uploadedAssets = dam.assets.flatMap(asset => {
    if (!asset || typeof asset !== "object") return [];
    const value = asset as Record<string, unknown>;
    return typeof value.path === "string" ? [value.path] : [];
  });
  const record: MigrationRecord = {
    id: report.id, sourceUrl, aemPage: pagePath,
    components: [...new Set(resourceTypes)],
    changedFiles: files.flatMap(file => file && typeof file === "object" && typeof (file as Record<string, unknown>).file === "string" ? [(file as Record<string, string>).file] : []),
    assets: uploadedAssets,
    errors: Array.isArray(report.errors) ? report.errors.filter((x): x is string => typeof x === "string") : [],
    checkpoints: (checkpoint.completed ?? []).filter((x): x is string => typeof x === "string"),
    modelChoices: [{ stage: "historical-run", agent: null, provider: null, model: null, evidence: "The pilot artifacts do not record concrete per-task model choices; no model is inferred." }],
    status: typeof report.status === "string" ? report.status : "imported-for-review",
    evidenceDirectory, createdAt: typeof report.finishedAt === "string" && Number.isFinite(Date.parse(report.finishedAt)) ? report.finishedAt : now, updatedAt: now, correctionRequests: [],
  };
  records.push(record);
  await persist(directory, records);
  return record;
}

async function readHistoricalCheckpoint(reportFile: string, directory: string): Promise<string> {
  const report = JSON.parse(await readFile(reportFile, "utf8")) as { id?: string };
  if (!report.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(report.id)) throw Error("INVALID_PILOT_ID");
  return readFile(join(directory, report.id + ".checkpoint.json"), "utf8");
}

/** Discover historical reports, never execute or rewrite their artifacts. */
export async function importLocalPilots(directory: string, evidenceRoot: string): Promise<void> {
  let entries;
  try { entries = await readdir(evidenceRoot, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const entry of entries.filter(e => e.isDirectory() && /^[a-f0-9]{20}$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const evidence = join(evidenceRoot, entry.name);
    try { await importCompletedLocalPilot(directory, join(evidence, "final-report.json"), evidence); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

export async function updateMigrationRecord(directory: string, record: MigrationRecord): Promise<void> {
  const records = await readMigrationRecords(directory);
  const index = records.findIndex(r => r.id === record.id);
  if (index < 0) throw Error("MIGRATION_NOT_FOUND");
  records[index] = { ...record, updatedAt: new Date().toISOString() };
  await persist(directory, records);
}

export async function requestCorrectionForLatest(directory: string, request = "Corrija a última migração"): Promise<MigrationRecord> {
  const records = await readMigrationRecords(directory);
  const latest = [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
  if (!latest) throw new Error("NO_MIGRATION_TO_CORRECT");
  const pending = latest.correctionRequests.at(-1);
  if (pending?.request === request.slice(0, 4000) && pending.outcome === "blocked") return latest;
  const now = new Date().toISOString();
  const normalizedRequest = request.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const details = normalizedRequest.match(/\b(?:migracao|migration)\b([\s\S]*)$/i)?.[1]?.replace(/^[\s.!?:;,—-]+/, "").trim();
  const hasFailures = latest.errors.length > 0 || Boolean(details);
  const note = hasFailures
    ? "Recorded failures or user-reported defects were loaded for targeted diagnosis; this lookup makes no project or AEM writes."
    : "No recorded failing evidence exists. Preserve the implementation and keep the migration at its human-review checkpoint.";
  latest.correctionRequests.push({ at: now, outcome: hasFailures ? "blocked" : "awaiting-review", note, request: request.slice(0, 4000) });
  latest.updatedAt = now;
  await persist(directory, records);
  return latest;
}
