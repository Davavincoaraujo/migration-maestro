import { executeMigrationRequest } from "./autopilot/execute-request.js";

try {
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) throw Error("MIGRATION_REQUEST_REQUIRED");
  const result = await executeMigrationRequest(text);
  console.log(JSON.stringify(result, null, 2));
  if ("blocked" in result && result.blocked) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MIGRATION_REQUEST_FAILED";
  console.error(code); process.exitCode = 1;
}
