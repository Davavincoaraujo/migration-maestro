import { readMigrationRecords } from "./autopilot/natural-language-intake.js";
import { revalidateLocalMigration } from "./autopilot/revalidate-local-migration.js";

try {
  const id = process.argv[2];
  const records = await readMigrationRecords(".local-maestro/migrations");
  const record = id ? records.find(r => r.id === id) : records.at(-1);
  if (!record) throw Error("MIGRATION_NOT_FOUND");
  const report = await revalidateLocalMigration(record);
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some(c => c.status === "blocked" || c.status === "failed")) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_REVALIDATION_FAILED");
  process.exitCode = 1;
}
