import { migrateCli } from "./cli-maestro-migrate.js";
try {
  const result = await migrateCli(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  if ("blocked" in result && result.blocked) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED");
  process.exitCode = 1;
}
