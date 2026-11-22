import { writeDeliveryManifest } from "./delivery-manifest.js";
import type { ExecutionBudget } from "./execution-budget.js";
import { standardPortalValidation, type ValidationPolicy } from "./validation-cycle.js";
import type { ExecutionAuthorization } from "./execution-authorization.js";
import type { DispatchExecutor } from "./dispatch-executor.js";
import { open, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCentralWorkflow } from "./central-controller.js";
import { FileCheckpointStore } from "./file-checkpoint-store.js";
import { localMigrationWorkflow, type LocalMigrationConfig } from "./local-migration-workflow.js";
import { sha256 } from "../integrations/aem-create-only.js";
import { importLocalPilots, parseMigrationIntent, recordMigrationRequest, requestCorrectionForLatest, updateMigrationRecord, type MigrationRecord } from "./natural-language-intake.js";
import type { MaestriTransport } from "../integrations/maestri-central-cli.js";

export async function executeMigrationRequest(text: string, options: {
  budget?: ExecutionBudget; validationPolicy?: ValidationPolicy;
  authorization?: ExecutionAuthorization; target?: string;
  directory?: string; historicalDirectory?: string; config?: LocalMigrationConfig;
  pauseAfter?: "ANALYZE" | "MAP_COMPONENTS" | "PLAN";
  env?: NodeJS.ProcessEnv; transport?: MaestriTransport; executor?: DispatchExecutor | "deferred"; maxPolls?: number; pollMs?: number;
} = {}) {
  const intent = parseMigrationIntent(text);
  if (intent.kind === "unknown") throw Error("UNRECOGNIZED_MIGRATION_REQUEST");
  const directory = options.directory ?? ".local-maestro/migrations";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockFile = join(directory, "request.lock");
  const lock = await open(lockFile, "wx").catch(() => { throw Error("REQUEST_LOCKED_REQUIRES_RECONCILIATION"); });
  try {
    await importLocalPilots(directory, options.historicalDirectory ?? ".local-maestro/central-demo");
    const record = intent.kind === "migrate" ? await recordMigrationRequest(directory, intent.url) : await requestCorrectionForLatest(directory, text);
    const savedConfig = record.executionConfig;
    const config = options.config ?? (savedConfig ? { project: savedConfig.project, pageRoot: savedConfig.pageRoot, damRoot: savedConfig.damRoot } : undefined);
    if (savedConfig && options.config && (["project", "pageRoot", "damRoot"] as const).some(key => options.config![key] !== savedConfig[key])) throw Error("MIGRATION_CONFIG_CHANGED");
    if (config && !savedConfig) record.executionConfig = { ...config, target: options.target ?? record.aemPage, environment: "non-production", policy: { pauseAfter: options.pauseAfter ?? null, dispatchMode: options.executor === "deferred" ? "deferred" : "official" } };
    if (options.target) {
      const { contentPath } = await import("../integrations/aem-create-only.js");
      const { defaultLocalMigrationConfig } = await import("./local-migration-workflow.js");
      contentPath(options.target, (config ?? defaultLocalMigrationConfig).pageRoot);
      if (record.aemPage && record.aemPage !== options.target) throw Error("MIGRATION_TARGET_CHANGED");
      record.aemPage = options.target;
    }
    if (intent.kind === "migrate" && ["awaiting-human-review", "complete"].includes(record.status)) return { record, execution: "existing migration recovered; no writes repeated", executed: false };
    const correction = intent.kind === "correct-latest" ? record.correctionRequests.at(-1) : undefined;
    if (correction?.outcome === "awaiting-review") return { record, execution: "no actionable defect supplied or recorded; human review pending", executed: false };
    const id = sha256(record.id + (correction ? ":correction:" + correction.at : "")).slice(0, 20);
    const runs = join(directory, "runs");
    const evidence = join(runs, id);
    const execution = { jobId: id, kind: correction ? "correction" as const : "migration" as const, evidenceDirectory: evidence, status: "running", completed: [] as string[], error: undefined as string | undefined };
    record.executions ??= [];
    const priorExecution = record.executions.findIndex(e => e.jobId === id);
    if (priorExecution < 0) record.executions.push(execution);
    else record.executions[priorExecution] = execution;
    record.status = "running";
    await updateMigrationRecord(directory, record);
    try {
      const checkpoint = await runCentralWorkflow({ id, directory: runs, transport: options.transport, executor: options.executor, pauseAfter: options.pauseAfter, budget: options.budget, maxPolls: options.maxPolls, pollMs: options.pollMs,
        workflow: localMigrationWorkflow({ record, jobId: id, authorization: options.authorization, correction: correction?.request, config, env: options.env, transport: options.transport, executor: options.executor, validationPolicy: options.validationPolicy ?? standardPortalValidation(config?.project ?? "/Users/macos/Developer/iibr-fed-portalbradesco") }) });
      execution.completed = checkpoint.completed;
      if (options.pauseAfter && checkpoint.state === "running") {
        execution.status = "paused";
        record.status = "paused";
        if (!correction) { record.checkpoints = checkpoint.completed; record.evidenceDirectory = evidence; }
        record.errors = [];
        await updateMigrationRecord(directory, record);
        return { record, execution: "paused-after-" + options.pauseAfter, executed: true, paused: true, resumeDirectory: evidence };
      }
      execution.status = "awaiting-human-review";
      if (!correction) record.checkpoints = checkpoint.completed;
      record.status = "awaiting-human-review";
      record.errors = [];
      if (!correction) record.evidenceDirectory = evidence;
      for (const value of Object.values(checkpoint.outputs)) {
        const route = (value as { modelRoute?: { agentId: string; provider: string; modelId: string } }).modelRoute;
        if (route) record.modelChoices.push({ stage: (value as { result: { stage: string } }).result.stage, agent: route.agentId, provider: route.provider, model: route.modelId, evidence: "Session footer observed before dispatch; stage result and route receipt persisted. No provider token/billing telemetry available." });
      }
      const impl = JSON.parse(await readFile(join(evidence, "implementation.json"), "utf8")) as { changedFiles: string[]; assets: { path: string }[] };
      record.changedFiles = [...new Set([...record.changedFiles, ...impl.changedFiles])];
      if (!correction) {
        const created = JSON.parse(await readFile(join(evidence, "aem-create-report.json"), "utf8")) as { path: string };
        record.aemPage = created.path;
        record.assets = impl.assets.map(a => a.path);
      }
      const delivery = await writeDeliveryManifest({ root: evidence, project: config?.project ?? "/Users/macos/Developer/iibr-fed-portalbradesco", checkpoint, files: impl.changedFiles });
      if (correction) { correction.outcome = "awaiting-review"; correction.note = "Targeted execution completed; independent validation and human review evidence persisted."; }
      await updateMigrationRecord(directory, record);
      return { record, delivery, execution: "local workflow reached human review; publication not authorized", executed: true };
    } catch (error) {
      record.status = "blocked";
      let code = error instanceof Error && /^[A-Za-z0-9_ :.-]{1,160}$/.test(error.message) ? error.message : "LOCAL_MIGRATION_BLOCKED";
      try {
        const failure = JSON.parse(await readFile(join(evidence, "failure.json"), "utf8")) as { error?: string };
        if (typeof failure.error === "string" && /^[A-Z0-9_]{1,160}$/.test(failure.error)) code = failure.error;
      } catch { /* No trustworthy structured failure: retain the bounded code. */ }
      record.errors = [code];
      const checkpoint = await new FileCheckpointStore(evidence).get(id);
      execution.status = "blocked"; execution.error = code; execution.completed = checkpoint?.completed ?? [];
      if (checkpoint && !correction) record.checkpoints = checkpoint.completed;
      await updateMigrationRecord(directory, record);
      return { record, execution: code, executed: false, blocked: true, resumeDirectory: evidence };
    }
  } finally { await lock.close(); await rm(lockFile, { force: true }); }
}
