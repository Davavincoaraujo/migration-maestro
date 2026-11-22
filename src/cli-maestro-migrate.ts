import { contentPath } from "./integrations/aem-create-only.js";
import { parseMigrationIntent } from "./autopilot/natural-language-intake.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executeMigrationRequest } from "./autopilot/execute-request.js";
import { defaultLocalMigrationConfig } from "./autopilot/local-migration-workflow.js";
import type { ExecutionAuthorization } from "./autopilot/execution-authorization.js";

export function parseMigrateArguments(args: string[]) {
  const values: Record<string, string> = {};
  const booleans = new Set<string>();
  const keys = ["--url", "--target", "--project", "--page-root", "--dam-root", "--environment", "--policy", "--authorization"];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--autopilot" || key === "--defer-dispatch") {
      if (booleans.has(key)) throw Error("DUPLICATE_ARGUMENT");
      booleans.add(key);
    } else {
      if (!keys.includes(key) || values[key] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw Error("INVALID_MIGRATION_ARGUMENTS");
      values[key] = args[++i];
    }
  }
  if (!values["--url"] || !values["--target"]) throw Error("URL_AND_TARGET_REQUIRED");
  if (values["--environment"] && values["--environment"] !== "non-production") throw Error("NON_PRODUCTION_ONLY");
  const policy = values["--policy"] ?? "plan-only";
  if (!["plan-only", "approved"].includes(policy) || (policy === "approved" && !values["--authorization"])) throw Error("APPROVED_POLICY_REQUIRES_AUTHORIZATION");
  const intent = parseMigrationIntent(values["--url"]);
  if (intent.kind !== "migrate") throw Error("INVALID_MIGRATION_URL");
  contentPath(values["--target"], values["--page-root"] ?? defaultLocalMigrationConfig.pageRoot);
  return { url: intent.url, target: values["--target"], config: {
    project: resolve(values["--project"] ?? defaultLocalMigrationConfig.project),
    pageRoot: values["--page-root"] ?? defaultLocalMigrationConfig.pageRoot,
    damRoot: values["--dam-root"] ?? defaultLocalMigrationConfig.damRoot,
  }, policy, authorizationFile: values["--authorization"], deferred: !booleans.has("--autopilot") || booleans.has("--defer-dispatch") };
}
export async function migrateCli(args: string[]) {
  const parsed = parseMigrateArguments(args);
  const authorization = parsed.authorizationFile ? JSON.parse(await readFile(parsed.authorizationFile, "utf8")) as ExecutionAuthorization : undefined;
  return executeMigrationRequest(parsed.url, { target: parsed.target, config: parsed.config, authorization,
    ...(parsed.policy === "plan-only" ? { pauseAfter: "PLAN" as const } : {}), ...(parsed.deferred ? { executor: "deferred" as const } : {}) });
}
// Kept separately from the parser so imports in tests never execute a migration.
