import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stages, migrationStages } from "./central-controller.js";
import { readNextjsParity, type NextjsParitySummary } from "./nextjs-parity.js";

export type PilotProgress = {
  id: string; stage: string; status: string; completed: number; total: number;
  nextjs?: NextjsParitySummary; humanApprovalRequired: true;
  publishingAuthorized: false; mergeAuthorized: false;
};

/** Reads bounded, sanitized checkpoint metadata for headless status consumers. */
export async function readAutopilotProgress(directory: string): Promise<PilotProgress[]> {
  let names: string[];
  try { names = await readdir(directory); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const rows: PilotProgress[] = [];
  for (const id of names.filter(n => /^[a-f0-9]{20}$/.test(n)).sort().slice(0, 200)) {
    try {
      const dir = join(directory, id);
      if (!(await lstat(dir)).isDirectory()) continue;
      const file = join(dir, "status.json");
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 10000) continue;
      const status = JSON.parse(await readFile(file, "utf8"));
      if (!migrationStages.includes(status.stage) || !["running", "failed", "paused", "awaiting-human-review"].includes(status.status)) continue;
      let completed = 0;
      let total: number = stages.length;
      try {
        const checkpointFile = join(dir, id + ".checkpoint.json");
        const check = await lstat(checkpointFile);
        if (!check.isFile() || check.size > 5_000_000) continue;
        const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
        if (!Array.isArray(checkpoint.completed)) continue;
        const pipeline = checkpoint.completed.includes("discover-components") || ["DISCOVER_COMPONENTS", "CREATE_AEM_CONTENT", "UPLOAD_DAM_ASSETS"].includes(status.stage) ? migrationStages : stages;
        // Correction runs deliberately omit external creation stages.
        const declared = status.pipeline;
        if (declared !== undefined && (!Array.isArray(declared) || !declared.length || declared.length > 30 || new Set(declared).size !== declared.length || declared.some((s: unknown, i: number) => !migrationStages.includes(s as typeof migrationStages[number]) || (i > 0 && migrationStages.indexOf(s as typeof migrationStages[number]) <= migrationStages.indexOf(declared[i - 1]))))) continue;
        const candidates: readonly (readonly string[])[] = declared ? [declared] : [pipeline, ...(pipeline === migrationStages ? [migrationStages.filter(s => !["CREATE_AEM_CONTENT", "UPLOAD_DAM_ASSETS"].includes(s))] : [])];
        const matched = candidates.find(p => checkpoint.completed.length <= p.length && checkpoint.completed.every((s: unknown, i: number) => s === p[i].toLowerCase().replaceAll("_", "-")));
        if (!matched) continue;
        total = matched.length;
        completed = checkpoint.completed.length;
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue; }
      const nextjs = await readNextjsParity(dir, id);
      rows.push({ id, stage: status.stage, status: status.status, completed, total, ...(nextjs ? { nextjs } : {}), humanApprovalRequired: true, publishingAuthorized: false, mergeAuthorized: false });
    } catch { /* Ignore incomplete or malformed status; never expose raw evidence. */ }
  }
  return rows;
}
