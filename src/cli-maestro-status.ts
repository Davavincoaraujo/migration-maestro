import { migrationStatus } from "./autopilot/migration-status.js";
try {
  const [id, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error("INVALID_STATUS_ARGUMENTS");
  console.log(JSON.stringify(await migrationStatus(id), null, 2));
} catch (error) {
  console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MIGRATION_STATUS_FAILED"); process.exitCode = 1;
}
