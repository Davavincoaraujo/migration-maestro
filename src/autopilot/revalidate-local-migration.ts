import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { MigrationRecord } from "./natural-language-intake.js";
import { defaultLocalMigrationConfig } from "./local-migration-workflow.js";
import { AemCreateOnly, contentPath, sha256 } from "../integrations/aem-create-only.js";

export interface RevalidationCheck { name: string; status: "passed" | "failed" | "blocked" | "unverified"; evidence: string; }
/** Read-only current probes; never runs historical scripts or mutates AEM/DAM. */
export async function revalidateLocalMigration(record: MigrationRecord, options: {
  project?: string; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch;
} = {}) {
  const project = await realpath(options.project ?? defaultLocalMigrationConfig.project);
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const checks: RevalidationCheck[] = [];
  let historical: { file: string; finalSha256?: string; sha256?: string }[] = [];
  if (record.evidenceDirectory) {
    try { historical = JSON.parse(await readFile(join(record.evidenceDirectory, "final-files.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const file of record.changedFiles) {
    try {
      const path = await realpath(join(project, file));
      if (!path.startsWith(project + "/")) throw Error("FILE_OUTSIDE_PROJECT");
      const digest = sha256(await readFile(path));
      const expected = historical.find(item => item.file === file);
      const match = expected?.finalSha256 ?? expected?.sha256;
      checks.push({ name: "file:" + file, status: match && match !== digest ? "failed" : "passed", evidence: match ? "Current bytes compared with historical SHA-256: " + digest : "File exists; current SHA-256: " + digest });
    } catch { checks.push({ name: "file:" + file, status: "blocked", evidence: "Missing, inaccessible or outside the configured checkout." }); }
  }
  if (record.aemPage) {
    contentPath(record.aemPage, defaultLocalMigrationConfig.pageRoot);
    const sourceExtension = new URL(record.sourceUrl).pathname.match(/\.(s?html?)$/i)?.[0] ?? "";
    const route = record.aemPage.slice(defaultLocalMigrationConfig.pageRoot.length) + sourceExtension;
    const url = "http://localhost:3000" + route;
    try {
      const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      checks.push({ name: "nextjs", status: response.status === 200 ? "passed" : "failed", evidence: "Current GET returned HTTP " + response.status });
      await response.body?.cancel();
    } catch { checks.push({ name: "nextjs", status: "blocked", evidence: "Current local HTTP probe unavailable; no historical status reused." }); }
    let client: AemCreateOnly | undefined;
    try { client = new AemCreateOnly(env, ".local-maestro/unused-readonly-receipts", fetcher); }
    catch (error) { checks.push({ name: "aem-auth", status: "blocked", evidence: error instanceof Error ? error.message : "AEM_AUTH_UNAVAILABLE" }); }
    if (client) {
      for (const path of [record.aemPage + ".1.json", record.aemPage + ".model.json", ...record.assets.map(p => contentPath(p, defaultLocalMigrationConfig.damRoot) + "/jcr:content/renditions/original")]) {
        try { const bytes = await client.bytes(path); checks.push({ name: path, status: bytes ? "passed" : "failed", evidence: bytes ? "Current authenticated GET; SHA-256: " + sha256(bytes) : "Current GET returned HTTP 404." }); }
        catch (error) { checks.push({ name: path, status: "blocked", evidence: error instanceof Error ? error.message : "AEM_READ_UNAVAILABLE" }); }
      }
    }
  }
  for (const name of ["portal-tests", "portal-typecheck", "portal-build", "desktop", "mobile", "accessibility", "video-playback", "video-captions", "video-consent"]) checks.push({ name, status: "unverified", evidence: "Not executed by this read-only probe; historical results are not current validation." });
  return { migrationId: record.id, checkedAt: new Date().toISOString(), status: "awaiting-human-review", checks, writesPerformed: false, modelsExecuted: [], historicalResultsReused: false };
}
