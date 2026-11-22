import { readIsolatedPilotStates } from "./isolated-next-pilot.js";
import { readMigrationRecords } from "./natural-language-intake.js";
import { readAutopilotProgress } from "./progress-reader.js";
import { executeMigrationRequest } from "./execute-request.js";

/** No directory creation, polling, dispatch, or external probes. */
export async function migrationStatus(id?: string, directory = ".local-maestro/migrations", syntheticDirectory = ".local-maestro/central-demo", isolatedDirectory = ".local-maestro/isolated-next") {
  const records = await readMigrationRecords(directory);
  const progress = [...await readAutopilotProgress(syntheticDirectory), ...await readAutopilotProgress(directory + "/runs")];
  const isolated = await readIsolatedPilotStates(isolatedDirectory);
  if (id && !isolated.some(job => job.jobId === id) && !records.some(r => r.id === id || r.executions?.some(e => e.jobId === id)) && !progress.some(p => p.id === id)) throw Error("MIGRATION_NOT_FOUND");
  return { isolatedJobs: isolated.filter(job => !id || job.jobId === id), records: records.filter(r => !id || r.id === id || r.executions?.some(e => e.jobId === id)), jobs: progress.filter(p => !id || p.id === id), externalProbesPerformed: false, writesPerformed: false };
}
export async function resumeMigration(id: string, options: Parameters<typeof executeMigrationRequest>[1] = {}) {
  const records = await readMigrationRecords(options.directory ?? ".local-maestro/migrations");
  const record = records.find(r => r.id === id || r.executions?.some(e => e.jobId === id));
  if (!record) throw Error("MIGRATION_NOT_FOUND");
  const latest = [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
  if (record.executions?.at(-1)?.kind === "correction" && latest?.id !== record.id) throw Error("HISTORICAL_CORRECTION_READ_ONLY");
  const correction = record.executions?.at(-1)?.kind === "correction";
  if (correction && id !== record.id && record.executions?.at(-1)?.jobId !== id) throw Error("HISTORICAL_EXECUTION_READ_ONLY");
  const request = correction ? record.correctionRequests.at(-1)?.request : record.sourceUrl;
  if (!request) throw Error("RESUME_REQUEST_MISSING");
  return executeMigrationRequest(request, options);
}
