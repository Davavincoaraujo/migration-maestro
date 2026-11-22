import { stageBudget, type ExecutionBudget } from "./execution-budget.js";
import { syntheticPlanInstructions, validateSyntheticPlan } from "./synthetic-plan-contract.js";
import { syntheticMappingInstructions, validateSyntheticMapping } from "./synthetic-mapping-contract.js";
import { cliDispatchExecutor, executePendingDispatch, persistDispatchRequest, verifyDispatch, type DispatchExecutor } from "./dispatch-executor.js";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { FileCheckpointStore } from "./file-checkpoint-store.js";
import { runCheckpointed } from "./checkpoint-runner.js";
import { fetchAnalystCatalogLocal } from "../integrations/local-analyst-catalog.js";
import { MaestriCommandError, maestriTransport, type MaestriTransport } from "../integrations/maestri-central-cli.js";
import { centralStageRoutes, findRateLimitedProvider, inspectMaestriModelSessions, routeMaestriStage } from "../integrations/maestri-model-router.js";
import { applyModelSuccessHistory, readModelRouterHistory, recordModelRouteOutcome } from "../ai/model-router-history.js";
import { classifyExecutionFailure, type AdaptiveProfile, type Provider, type AdaptiveRouteRequest, type AdaptiveRouteDecision } from "../ai/model-router.js";
import { readModelRouterConfig } from "../ai/model-router-config.js";

export const stages = ["ANALYZE", "MAP_COMPONENTS", "PLAN", "IMPLEMENT", "VALIDATE", "REVIEW"] as const;
export const migrationStages = ["ANALYZE", "DISCOVER_COMPONENTS", "MAP_COMPONENTS", "PLAN", "IMPLEMENT", "CREATE_AEM_CONTENT", "UPLOAD_DAM_ASSETS", "VALIDATE", "REVIEW"] as const;
export type Stage = typeof migrationStages[number];
const agents = { ANALYZE: "Analytics", MAP_COMPONENTS: "UE-Pattern", PLAN: "Hermes", IMPLEMENT: "Hermes", VALIDATE: "Analytics" } as const;
export const demo = { kind: "synthetic-hero-v1", title: "Explore the imaginary garden", cta: "Discover the garden", query: "hero" } as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Artifact = { file: string; digest: string };
type LegacyResult = { taskId: string; stage: Stage; status: "completed"; summary: string; evidence: string[] };
export type StageResultV2 = LegacyResult & { version: 2; jobId: string; artifacts: Artifact[] };
type Result = LegacyResult | StageResultV2;
type Receipt = { version?: 2; resultContractVersion?: 2; taskId: string; stage: Stage; polls: number; dispatch: "intent"; agentId?: string; routeDigest?: string; requestDigest?: string };
type Output = { resultContractVersion?: 2; artifacts?: Artifact[]; dispatch?: { taskId: string; agentId: string; routeDigest: string; requestDigest: string }; result: Result; resultDigest: string; htmlDigest?: string; catalog?: { digest: string; matches: number }; modelRoute?: { agentId: string; provider: Provider; modelId: string; profile: AdaptiveProfile; modelProfile: AdaptiveProfile; reason: string; estimatedCostUsd: number | null; attempts: number; escalationCount: number; operationalEvidence?: unknown } };
function reconciliationRecord(receipt: Receipt, agentId: string, route: Output["modelRoute"], action: "check-only" | "await-late-result" | "result-collected", extra: Record<string, unknown> = {}) {
  return {
    version: 1, taskId: receipt.taskId, agentId,
    route: route ? { agentId: route.agentId, provider: route.provider, modelId: route.modelId, profile: route.profile, modelProfile: route.modelProfile } : null,
    routeDigest: receipt.routeDigest ?? null,
    routeIntegrity: receipt.routeDigest ? "receipt-digest-verified" : "legacy-route-only",
    action, routePinned: true, providerSwitchAuthorized: false, resendAuthorized: false, ...extra,
  };
}
export type WorkflowArtifacts = { artifacts?: Artifact[] };
export interface CentralWorkflow {
  input: Record<string, unknown>;
  stages?: readonly Stage[];
  /** Coordinator-owned deterministic stages. Never delegate credentials/writes. */
  local?(stage: Stage, root: string): Promise<WorkflowArtifacts | undefined>;
  verify?(root: string): Promise<void>;
  routeRequest?(stage: Stage, root: string): Promise<Partial<AdaptiveRouteRequest>>;
  prepare(stage: Stage, root: string): Promise<void>;
  instructions(stage: Stage, root: string): string;
  validate(stage: Stage, root: string): Promise<WorkflowArtifacts>;
}
function validateArtifactPath(file: string) {
  if (typeof file !== "string" || file.length > 512 || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(file) || file.split("/").some(s => s === "." || s === "..")) throw Error("INVALID_ARTIFACT_PATH");
}
export async function artifactDigest(root: string, file: string): Promise<string> {
  validateArtifactPath(file);
  const path = join(root, file), resolved = await realpath(path);
  if (!resolved.startsWith(await realpath(root) + "/") || !(await lstat(path)).isFile() || (await lstat(path)).size > 5_000_000) throw Error("INVALID_ARTIFACT_PATH");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function atomicUnchecked(file: string, value: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  try { await writeFile(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
async function bounded(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 64000) throw Error("INVALID_ARTIFACT");
  return readFile(file, "utf8");
}
export function validateResult(raw: string, stage: Stage, taskId: string, contract?: { jobId: string; resultContractVersion?: 2 }): Result {
  const r = JSON.parse(raw) as Result;
  if (!r || r.taskId !== taskId || r.stage !== stage || r.status !== "completed" ||
    typeof r.summary !== "string" || !r.summary.trim() || r.summary.length > 2000 ||
    !Array.isArray(r.evidence) || !r.evidence.length || r.evidence.length > 20 ||
    r.evidence.some(x => typeof x !== "string" || !x.trim() || x.length > 2000)) throw Error("INVALID_STAGE_RESULT");
  if (contract?.resultContractVersion === 2) {
    const current = r as StageResultV2;
    if (current.version !== 2 || current.jobId !== contract.jobId ||
        !Array.isArray(current.artifacts) || !current.artifacts.length || current.artifacts.length > 20 ||
        current.artifacts.some(a => !a || typeof a !== "object" || typeof a.digest !== "string" || !/^[a-f0-9]{64}$/.test(a.digest)) ||
        new Set(current.artifacts.map(a => a.file)).size !== current.artifacts.length) throw Error("INVALID_STAGE_RESULT");
    for (const artifact of current.artifacts) validateArtifactPath(artifact.file);
  }
  return r;
}
/** Demo contract validation only: never executes specialist-provided code. */
export function validateDemoHtml(html: string) {
  if (!html.includes(demo.title) || !html.includes(demo.cta) ||
    !/<html\b[^>]*\blang=["']en["']/i.test(html) || !/<main\b/i.test(html) ||
    !/<h1\b[^>]*>[^<]+<\/h1>/i.test(html) || !/<a\b[^>]*href=["']#garden["']/i.test(html) ||
    !/\bid=["']garden["']/i.test(html) || !/@media/i.test(html) ||
    /<script\b|<iframe\b|<form\b|\bon\w+\s*=|javascript:|https?:|@import|url\s*\(/i.test(html)) throw Error("DEMO_HTML_CONTRACT_FAILED");
}

export async function readPersistedStageResult(root: string, jobId: string, stage: Stage, receipt: Receipt): Promise<Output | undefined> {
  let raw: string;
  try { raw = await bounded(join(root, stage + ".result.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const request = await verifyDispatch(root, stage, receipt);
  if (receipt.resultContractVersion === 2 && !request) throw Error("DISPATCH_PROVENANCE_MISMATCH");
  const result = validateResult(raw, stage, receipt.taskId, request);
  if (request?.resultContractVersion === 2) {
    const artifacts: Artifact[] = [];
    for (const artifact of (result as StageResultV2).artifacts) {
      let digest: string;
      try { digest = await artifactDigest(root, artifact.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw Error("RESULT_ARTIFACT_MISSING"); throw error; }
      if (digest !== artifact.digest) throw Error("RESULT_ARTIFACT_DIGEST_MISMATCH");
      artifacts.push({ file: artifact.file, digest });
    }
    if (request.mappingContractVersion === 1) {
      if (!artifacts.some(a => a.file === "MAP_COMPONENTS.mapping.json") || !artifacts.some(a => a.file === "MAP_COMPONENTS.evidence.json")) throw Error("MAPPING_ARTIFACT_REQUIRED");
      validateSyntheticMapping(JSON.parse(await bounded(join(root, "MAP_COMPONENTS.mapping.json"))), {
        jobId, taskId: receipt.taskId, analyzeResultDigest: hash(await bounded(join(root, "ANALYZE.result.json"))),
      });
    }
    if (request.planContractVersion === 1) {
      if (artifacts.length !== 2 || !artifacts.some(a => a.file === "PLAN.plan.json") || !artifacts.some(a => a.file === "PLAN.evidence.json")) throw Error("PLAN_ARTIFACT_REQUIRED");
      const mappingReceipt = JSON.parse(await bounded(join(root, "MAP_COMPONENTS.task.json"))) as Receipt;
      const mappingOutput = await readPersistedStageResult(root, jobId, "MAP_COMPONENTS", mappingReceipt);
      const mappingArtifact = mappingOutput?.artifacts?.find(a => a.file === "MAP_COMPONENTS.mapping.json");
      const mappingRequest = await verifyDispatch(root, "MAP_COMPONENTS", mappingReceipt);
      if (!mappingArtifact || mappingRequest?.mappingContractVersion !== 1 || mappingArtifact.digest !== request.mappingDigest) throw Error("PLAN_MAPPING_MISMATCH");
      validateSyntheticPlan(JSON.parse(await bounded(join(root, "PLAN.plan.json"))), {
        jobId, taskId: receipt.taskId, mappingDigest: mappingArtifact.digest,
        mapping: JSON.parse(await bounded(join(root, "MAP_COMPONENTS.mapping.json"))),
      });
    }
    return { result, resultDigest: hash(raw), resultContractVersion: 2, artifacts };
  }
  return { result, resultDigest: hash(raw) };
}

export async function runCentralWorkflow(options: {
  directory: string; id: string; transport?: MaestriTransport;
  executor?: DispatchExecutor | "deferred";
  /** Trusted continuation gate: called before persistence and each stage, including cached routes. */
  authorize?: (stage?: Stage) => Promise<void>;
  audit?: (event: Record<string, unknown>) => Promise<void>;
  budget?: ExecutionBudget;
  pauseAfter?: "ANALYZE" | "MAP_COMPONENTS" | "PLAN";
  stopOnAmbiguousDispatch?: boolean;
  syntheticMappingContract?: boolean;
  catalog?: () => Promise<unknown[]>; maxPolls?: number; pollMs?: number;
  workflow?: CentralWorkflow;
  /** Trusted application composition points; never loaded from terminal output/config code. */
  discoverSessions?: typeof inspectMaestriModelSessions;
  routingContext?: unknown;
  resolveRoute?: (stage: Stage, request: AdaptiveRouteRequest) => Promise<AdaptiveRouteDecision & { operationalEvidence?: unknown }>;
}) {
  if (!/^[a-f0-9]{20}$/.test(options.id)) throw Error("INVALID_JOB_ID");
  const maxPolls = options.maxPolls ?? 12, pollMs = options.pollMs ?? 5000;
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 30 || !Number.isInteger(pollMs) || pollMs < 0 || pollMs > 10000) throw Error("INVALID_RETRY_POLICY");
  const base = resolve(options.directory);
  const root = join(base, options.id);
  const workflowStages = options.workflow?.stages ?? stages;
  if (options.pauseAfter !== undefined && (!["ANALYZE", "MAP_COMPONENTS", "PLAN"].includes(options.pauseAfter) || !workflowStages.includes(options.pauseAfter))) throw Error("INVALID_PAUSE_STAGE");
  if (options.syntheticMappingContract && options.workflow) throw Error("SYNTHETIC_MAPPING_ONLY");
  if (basename(base)==='continuations' && !options.authorize) throw Error('CONTINUATION_GATE_REQUIRED');
  for (const marker of ['analytics-probe-recovery.json', 'continuation.json']) {
    try {
      await lstat(join(root, marker));
      if (marker === 'analytics-probe-recovery.json' || !options.authorize) throw Error('CONTINUATION_GATE_REQUIRED');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  await options.authorize?.();
  await mkdir(root, { recursive: true });
  // Specialists are shared: serialize all jobs for this controller directory.
  const lockPath = join(base, "controller.lock");
  const lock = await open(lockPath, "wx").catch(() => { throw Error("CONTROLLER_LOCKED_REQUIRES_OPERATOR_RECONCILIATION"); });
  const transport = options.transport ?? maestriTransport();
  const diskStore = new FileCheckpointStore(root);
  const store = { get: diskStore.get.bind(diskStore), put: async (checkpoint: Parameters<typeof diskStore.put>[0]) => {
    await options.authorize?.(); await diskStore.put(checkpoint);
  }};
  const atomic = async (file: string, value: unknown) => { await options.authorize?.(); await atomicUnchecked(file,value); };
  const event = async (stage: Stage, action: string) => {
    await options.authorize?.();
    const record = { at: new Date().toISOString(), stage, action };
    if(options.audit) await options.audit(record);
    else await appendFile(join(root, "events.jsonl"), JSON.stringify(record) + "\n");
  };
  const readResult = (stage: Stage, receipt: Receipt) => readPersistedStageResult(root, options.id, stage, receipt);
  const verifyEvidence = async (name: string, output: Output) => {
    const stage = name.replaceAll("-", "_").toUpperCase() as Stage;
    if (!workflowStages.includes(stage)) throw Error("UNKNOWN_CACHED_STAGE");
    if (stage !== "REVIEW") {
      if ((output as Output & { deterministic?: boolean }).deterministic) {
        for (const artifact of (output as WorkflowArtifacts).artifacts ?? []) {
          if (await artifactDigest(root, artifact.file) !== artifact.digest) throw Error("ARTIFACT_CHANGED");
        }
        return;
      }
      let receipt: Receipt = { taskId: output.result.taskId, stage, polls: 0, dispatch: "intent" };
      if (output.dispatch) {
        receipt = JSON.parse(await bounded(join(root, stage + ".task.json"))) as Receipt;
        const stored = JSON.parse(await bounded(join(root, stage + ".route.json")));
        if (receipt.taskId !== output.result.taskId || receipt.taskId !== output.dispatch.taskId ||
            receipt.agentId !== output.dispatch.agentId || receipt.routeDigest !== output.dispatch.routeDigest ||
            receipt.requestDigest !== output.dispatch.requestDigest || hash(JSON.stringify(stored.selected ?? stored.route)) !== receipt.routeDigest) throw Error("DISPATCH_PROVENANCE_MISMATCH");
        await verifyDispatch(root, stage, receipt);
      }
      const current = await readResult(stage, receipt);
      if (!current || current.resultDigest !== output.resultDigest) throw Error("EVIDENCE_CHANGED");
      if (current.resultContractVersion !== output.resultContractVersion) throw Error("RESULT_CONTRACT_MISMATCH");
      if (current.resultContractVersion === 2 && current.artifacts!.some(a => !output.artifacts?.some(saved => saved.file === a.file && saved.digest === a.digest))) throw Error("RESULT_ARTIFACT_DIGEST_MISMATCH");
    }
    if (output.htmlDigest && hash(await bounded(join(root, "index.html"))) !== output.htmlDigest) throw Error("IMPLEMENTATION_CHANGED");
    if (output.catalog && hash(JSON.stringify(JSON.parse(await bounded(join(root, "catalog.local.json"))))) !== output.catalog.digest) throw Error("CATALOG_EVIDENCE_CHANGED");
    for (const artifact of (output as Output & WorkflowArtifacts).artifacts ?? []) {
      if (await artifactDigest(root, artifact.file) !== artifact.digest) throw Error("ARTIFACT_CHANGED");
    }
  };
  let activeStep = "checkpoint-validation";
  try {
    // Validate completed outputs before trusting a resumed checkpoint, including REVIEW.
    const existing = await store.get(options.id);
    if (options.pauseAfter && existing?.completed.some(name => workflowStages.indexOf(name.replaceAll("-", "_").toUpperCase() as Stage) > workflowStages.indexOf(options.pauseAfter!))) throw Error("PAUSE_BOUNDARY_ALREADY_PASSED");
    if (existing?.state === "awaiting-review" && existing.completed.length !== workflowStages.length) throw Error("INCOMPLETE_REVIEW_CHECKPOINT");
    if (existing) for (const name of existing.completed) {
      await verifyEvidence(name, existing.outputs[name] as Output);
    }
    await options.workflow?.verify?.(root);
    // Completed evidence is reusable offline; reconnection cannot invalidate a local review.
    if (existing?.state === "awaiting-review") return existing;
    // A completed authorized continuation is reusable offline, without new status/events.
    if (options.audit && options.pauseAfter && existing?.completed.at(-1) === options.pauseAfter.toLowerCase().replaceAll("_", "-")) return existing;
    activeStep = "agent-discovery";
    const listing = await transport("list", []);
    if (!options.workflow?.stages) for (const agent of new Set(Object.values(agents))) if (!listing.includes(`name: "${agent}"`)) throw Error("AGENT_NOT_CONNECTED_" + agent);
    const modelConfig = await readModelRouterConfig();
    const modelHistoryFile = join(base, "model-router-history.json");
    const modelHistory = await readModelRouterHistory(modelHistoryFile);
    const modelSessions = await (options.discoverSessions ?? inspectMaestriModelSessions)(transport, listing, modelConfig);
    if (modelSessions && modelHistory) modelSessions.candidates = applyModelSuccessHistory(modelSessions.candidates, modelHistory);
    if (modelSessions) await atomic(join(root, "model-sessions.json"), {
      observedAt: new Date().toISOString(),
      discovery: "Maestri check visible terminal footer; no transcripts persisted",
      sessions: modelSessions.sessions,
      catalogCostsAvailable: false,
    });
    const checkpoint = await runCheckpointed(options.id, { controllerVersion: 1, demo: options.workflow?.input ?? demo, root, ...(options.routingContext ? { routingContext: options.routingContext } : {}), ...(options.budget ? { budget: options.budget } : {}) }, workflowStages.map(stage => ({
      id: stage.toLowerCase().replaceAll("_", "-"),
      run: async (_input: unknown, previous: Readonly<Record<string, unknown>>) => {
        await options.authorize?.(stage);
        activeStep = `stage:${stage}`;
        let receipt: Receipt | undefined;
        let routedAgent: string = stage in agents ? agents[stage as keyof typeof agents] : "UE-Pattern";
        let routeRecord: Output["modelRoute"];
        try {
        for (const [name, output] of Object.entries(previous)) await verifyEvidence(name, output as Output);
        await options.workflow?.verify?.(root);
        if (stage === "IMPLEMENT" && (previous.plan as Output | undefined)?.artifacts?.some(a => a.file === "PLAN.plan.json")) {
          const plan = JSON.parse(await bounded(join(root, "PLAN.plan.json")));
          if (plan.blockers?.length) throw Error("PLAN_UNRESOLVED_BLOCKERS");
        }
        await atomic(join(root, "status.json"), { stage, pipeline: workflowStages, status: stage === "REVIEW" ? "awaiting-human-review" : "running", publishingAuthorized: false, mergeAuthorized: false });
        if (stage === "REVIEW") {
          await event(stage, "awaiting-human-review-no-publication-or-merge");
          return { humanApprovalRequired: true, publishingAuthorized: false, mergeAuthorized: false,
            implementationDigest: (previous.implement as Output | undefined)?.htmlDigest ??
              (previous.implement as WorkflowArtifacts | undefined)?.artifacts?.find(a => a.file === "index.html")?.digest };
        }
        await options.workflow?.prepare(stage, root);
        const local = await options.workflow?.local?.(stage, root);
        if (local !== undefined) {
          await event(stage, "deterministic-no-model-call");
          return { ...local, deterministic: true };
        }
        let catalog: Output["catalog"];
        if (stage === "MAP_COMPONENTS" && !options.workflow) {
          let persistedMappingV1 = false;
          try { persistedMappingV1 = JSON.parse(await bounded(join(root, "MAP_COMPONENTS.dispatch.json"))).mappingContractVersion === 1; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const content = options.syntheticMappingContract || persistedMappingV1 ? [{ type: "text", text: JSON.stringify({ matches: [{ kind: "synthetic-only", component: "semantic-hero", corporateReuseVerified: false }] }) }] : options.catalog ? await options.catalog() : (await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query: demo.query, limit: 3 })).content;
          const matches = content.flatMap(block => {
            if (!block || typeof block !== "object" || !("text" in block) || typeof block.text !== "string") return [];
            const value = JSON.parse(block.text) as { matches?: unknown[] };
            return Array.isArray(value.matches) ? value.matches : [];
          });
          if (!matches.length) throw Error("CATALOG_EVIDENCE_MISSING");
          // Raw catalog stays local and never enters a specialist prompt.
          await atomic(join(root, "catalog.local.json"), content);
          catalog = { digest: hash(JSON.stringify(content)), matches: matches.length };
        }
        const taskFile = join(root, stage + ".task.json");
        const routeFile = join(root, stage + ".route.json");
        try {
          receipt = JSON.parse(await bounded(taskFile)) as Receipt;
          if (receipt.version === 2 && !/^[a-f0-9]{64}$/.test(receipt.requestDigest ?? "")) throw Error("DISPATCH_REQUEST_RECONCILIATION_REQUIRED");
          if (receipt.stage !== stage || !/^[a-f0-9-]{36}$/.test(receipt.taskId) || receipt.dispatch !== "intent" || !Number.isInteger(receipt.polls) || receipt.polls < 0 || receipt.polls > 30) throw Error("INVALID_TASK_RECEIPT");
          try {
            const stored = JSON.parse(await bounded(routeFile)) as { route?: Output["modelRoute"]; selected?: Output["modelRoute"] };
            const selected = stored.selected ?? stored.route;
            if (!selected?.agentId || typeof selected.agentId !== "string") throw Error("DISPATCH_ROUTE_REQUIRED");
            if (receipt.agentId !== undefined || receipt.routeDigest !== undefined) {
              if (receipt.agentId !== selected.agentId || receipt.routeDigest !== hash(JSON.stringify(selected))) throw Error("DISPATCH_ROUTE_MISMATCH");
            }
            routedAgent = selected.agentId; routeRecord = selected;
          } catch (error) {
            // A missing route is not a missing receipt. Never enter the new-send branch.
            throw Error(error instanceof Error && error.message === "DISPATCH_ROUTE_MISMATCH" ? error.message : "DISPATCH_ROUTE_RECONCILIATION_REQUIRED");
          }
          await atomic(join(root, stage + ".reconciliation.json"), reconciliationRecord(receipt, routedAgent, routeRecord, "check-only"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          // A lost receipt never proves an earlier send was not delivered.
          let priorRoute: { selected?: unknown; route?: unknown } | undefined;
          try { priorRoute = JSON.parse(await bounded(routeFile)); }
          catch (routeError) { if ((routeError as NodeJS.ErrnoException).code !== "ENOENT") throw Error("DISPATCH_ROUTE_RECONCILIATION_REQUIRED"); }
          if (priorRoute?.selected || priorRoute?.route) throw Error("DISPATCH_RECEIPT_RECONCILIATION_REQUIRED");
          let priorEvents = "";
          try { priorEvents = await readFile(join(root, "events.jsonl"), "utf8"); }
          catch (eventError) { if ((eventError as NodeJS.ErrnoException).code !== "ENOENT") throw eventError; }
          if (priorEvents.split("\n").filter(Boolean).some(line => {
            const e = JSON.parse(line) as { stage?: string; action?: string };
            return e.stage === stage && e.action === "dispatch-intent";
          })) throw Error("DISPATCH_RECEIPT_RECONCILIATION_REQUIRED");
          const prepared = (await readdir(root)).filter(file => /^[A-Z_]+\.task\.json$/.test(file));
          const reservations = await Promise.all(prepared.map(async file => {
            const route = JSON.parse(await bounded(join(root, file.replace(".task.json", ".route.json"))));
            return (route.selected ?? route.route)?.estimatedCostUsd ?? null;
          }));
          const costCeiling = stageBudget(options.budget ?? { maxDispatches: workflowStages.length }, reservations);
          if (!modelSessions) throw Error("MODEL_SESSION_DISCOVERY_MISSING");
          const limitedProvider = findRateLimitedProvider(modelSessions.sessions, stage, modelConfig);
          const request = { ...centralStageRoutes[stage]?.request, ...await options.workflow?.routeRequest?.(stage, root), ...(costCeiling === undefined ? {} : { maxEstimatedCostUsd: costCeiling }),
            ...(stage === "VALIDATE" && (previous.implement as Output | undefined)?.modelRoute?.agentId ? { excludedAgentIds: [(previous.implement as Output).modelRoute!.agentId] } : {}) } as AdaptiveRouteRequest;
          const decision: AdaptiveRouteDecision & { operationalEvidence?: unknown } = options.resolveRoute
            ? await options.resolveRoute(stage, request)
            : routeMaestriStage(stage, modelSessions.candidates, { ...(limitedProvider ? { priorFailure: "rate_limit" as const, failedProvider: limitedProvider } : {}), request });
          if (decision.action !== "agent" || !decision.agentId || !decision.provider || !decision.modelId || !decision.modelProfile) {
            await atomic(routeFile, { stage, decision, blocked: true, at: new Date().toISOString() });
            await event(stage, "model-route-blocked:" + decision.profile);
            throw Error("MODEL_ROUTE_BLOCKED_" + stage);
          }
          if (decision.additionalReviewRequired) throw Error("HUMAN_APPROVAL_AND_VERIFIABLE_EVIDENCE_REQUIRED");
          routedAgent = decision.agentId;
          routeRecord = { agentId: decision.agentId, provider: decision.provider, modelId: decision.modelId,
            profile: decision.profile, modelProfile: decision.modelProfile, reason: decision.reason, estimatedCostUsd: decision.estimatedCostUsd,
            attempts: decision.attempts, escalationCount: decision.escalationCount,
            ...(decision.operationalEvidence ? { operationalEvidence: decision.operationalEvidence } : {}) };
          await atomic(routeFile, { stage, decision, selected: routeRecord, at: new Date().toISOString() });
          await event(stage, `model-route:${decision.profile}:${decision.provider}:${decision.modelId}:${decision.agentId}`);
          receipt = { version: 2, resultContractVersion: 2, taskId: randomUUID(), stage, polls: 0, dispatch: "intent", agentId: routedAgent, routeDigest: hash(JSON.stringify(routeRecord)) };
          await atomic(taskFile, receipt); // Ambiguous crash after this point must never resend.
          await event(stage, "dispatch-intent");
          const resultPath = join(root, stage + ".result.json");
          // Only new requests adopt the contract. Persisted requests retain their original version.
          const planMapping = !options.workflow && stage === "PLAN"
            ? (previous["map-components"] as Output | undefined)?.artifacts?.find(a => a.file === "MAP_COMPONENTS.mapping.json") : undefined;
          if (planMapping) {
            const mappingReceipt = JSON.parse(await bounded(join(root, "MAP_COMPONENTS.task.json"))) as Receipt;
            if ((await verifyDispatch(root, "MAP_COMPONENTS", mappingReceipt))?.mappingContractVersion !== 1) throw Error("PLAN_MAPPING_CONTRACT_REQUIRED");
          }
          const resultInstructions = [
            `Write a JSON result file at ${resultPath} with taskId equal to ${receipt.taskId}, stage equal to ${stage}, version 2, jobId equal to ${options.id}, status completed only if successful, summary string and evidence array of concrete nonempty strings.`,
            `Also write your stage evidence artifact ${stage}.evidence.json in ${root}, containing your concrete findings and limitations. This file is explicitly assigned in addition to workflow artifacts.`,
            `The result MUST contain artifacts: [{"file":"${stage}.evidence.json","digest":"<SHA-256 of exact file bytes, 64 lowercase hex characters>"}]. Include any other assigned artifacts you produce. Paths must be relative to ${root}, without traversal or symlinks escaping that directory. Maximum 20 unique artifacts, 5 MB each. Never include the result file itself or controller records. Write artifacts first and atomically rename the completed result file last.`,
          ].join("\n");
          const prompt = options.workflow ? [
            `Migration Orchestrator central task ${receipt.taskId}; stage ${stage}.`,
            options.workflow.instructions(stage, root),
            resultInstructions,
            "Do not modify controller state, task receipts or preceding results. Only write the files explicitly assigned. Do not send spontaneous messages: the central controller polls with maestri check."
          ].join("\n") : [
            `Migration Orchestrator central task ${receipt.taskId}; stage ${stage}.`,
            `Work only in this isolated synthetic demo directory: ${root}. No private/corporate input. No production, AEM, git, network, merge or publishing.`,
            `Synthetic fixture: ${JSON.stringify(demo)}. Read preceding *.result.json files in this directory as evidence; do not read catalog.local.json or other projects.`,
            stage === "ANALYZE" ? "Inventory the synthetic hero content, semantics, CTA target and responsive requirements." :
            stage === "MAP_COMPONENTS" && options.syntheticMappingContract ? "Map only the supplied synthetic fixture; no real catalog was queried and no corporate reuse is verified." :
            stage === "MAP_COMPONENTS" ? "Describe a generic demo hero mapping and gaps. The controller queried the real Analyst catalog locally; private candidates are withheld. Do not claim a verified corporate component match." :
            stage === "PLAN" ? "Plan a standalone static index.html demo using inline CSS, semantic main/h1, lang=en, media query, link href=#garden and element id=garden. No scripts, external resources or forms." :
            stage === "IMPLEMENT" ? "Create index.html here following the validated plan and exact fixture title/CTA. Inline CSS with @media, html lang=en, main, h1, link href=#garden, target id=garden. No scripts, event handlers, external resources, forms or URLs." :
            "Read index.html and independently assess fixture fidelity, semantic accessibility, responsive CSS, and absence of external resources. Do not edit index.html. Report limitations; do not claim browser tests.",
            ...(stage === "MAP_COMPONENTS" && options.syntheticMappingContract ? [syntheticMappingInstructions] : []),
            ...(stage === "PLAN" && (previous["map-components"] as Output | undefined)?.artifacts?.some(a => a.file === "MAP_COMPONENTS.mapping.json") ? ["Read the preceding verified MAP_COMPONENTS.mapping.json handoff; preserve its heading, CTA, anchor, semantic and responsive requirements."] : []),
            ...(planMapping ? [syntheticPlanInstructions(planMapping.digest)] : []),
            resultInstructions,
            "Only IMPLEMENT may create index.html. All stages may write their own result and stage evidence files. Do not modify controller state or other files. Reply briefly when done. Do not send spontaneous messages; the controller polls with maestri check."
          ].join("\n");
          receipt.requestDigest = await persistDispatchRequest(root, {
            version: 1, resultContractVersion: 2, ...(stage === "MAP_COMPONENTS" && options.syntheticMappingContract ? { mappingContractVersion: 1 as const } : {}), ...(planMapping ? { planContractVersion: 1 as const, mappingDigest: planMapping.digest } : {}), jobId: options.id, taskId: receipt.taskId, stage, agentId: routedAgent,
            routeDigest: receipt.routeDigest!, prompt,
          });
          await atomic(taskFile, receipt);
          if (options.executor === "deferred") throw Error("AUTHORIZED_EXECUTOR_REQUIRED");
          const dispatch = await executePendingDispatch(root, stage, options.executor ?? cliDispatchExecutor(transport));
          if (dispatch.outcome === "unknown") await event(stage, "ask-failed-or-timed-out-check-only-no-resend");
          if (dispatch.outcome === "unknown" && options.stopOnAmbiguousDispatch) throw Error("AMBIGUOUS_DISPATCH_RECONCILIATION_REQUIRED");
        }
        if (!receipt) throw Error("TASK_RECEIPT_MISSING");
        if (stage === "VALIDATE" && routedAgent === (previous.implement as Output | undefined)?.modelRoute?.agentId) throw Error("INDEPENDENT_VALIDATOR_REQUIRED");
        if (receipt.requestDigest) await verifyDispatch(root, stage, receipt);
        const taskReceipt = receipt;
        let output: Output | undefined;
        // Resume may consume a late result even after polling budget was exhausted.
        const collect = () => readResult(stage, taskReceipt);
        output = await collect();
        if (output && receipt.polls === 0) {
          receipt.polls++;
          await atomic(taskFile, receipt);
          try {
            const screen = await transport("check", [routedAgent]);
            await writeFile(join(root, `${stage}.check-${receipt.polls}.log`), JSON.stringify({ outputBytes: Buffer.byteLength(screen), contentRetained: false }), { mode: 0o600 });
          } catch { await event(stage, "check-failed-artifact-still-available"); }
        }
        while (!output && receipt.polls < maxPolls) {
          receipt.polls++;
          await atomic(taskFile, receipt);
          try {
            const screen = await transport("check", [routedAgent]);
            await writeFile(join(root, `${stage}.check-${receipt.polls}.log`), JSON.stringify({ outputBytes: Buffer.byteLength(screen), contentRetained: false }), { mode: 0o600 });
          } catch { await event(stage, "check-failed"); }
          output = await collect();
          if (!output && receipt.polls < maxPolls) await new Promise(r => setTimeout(r, pollMs));
        }
        if (!output) {
          await atomic(join(root, stage + ".reconciliation.json"), reconciliationRecord(receipt, routedAgent, routeRecord, "await-late-result"));
          throw Error("POLL_BUDGET_EXHAUSTED_NO_RESEND");
        }
        if (options.workflow) {
          const validated = await options.workflow.validate(stage, root);
          const artifacts = new Map((output.artifacts ?? []).map(a => [a.file, a]));
          for (const artifact of validated.artifacts ?? []) {
            if (await artifactDigest(root, artifact.file) !== artifact.digest || (artifacts.has(artifact.file) && artifacts.get(artifact.file)!.digest !== artifact.digest)) throw Error("ARTIFACT_CHANGED");
            artifacts.set(artifact.file, artifact);
          }
          if (artifacts.size) output.artifacts = [...artifacts.values()];
        }
        else if (stage === "IMPLEMENT" || stage === "VALIDATE") {
          const html = await bounded(join(root, "index.html"));
          validateDemoHtml(html);
          output.htmlDigest = hash(html);
          if (stage === "VALIDATE" && output.htmlDigest !== (previous.implement as Output).htmlDigest) throw Error("IMPLEMENTATION_CHANGED");
        }
        // check/prepare/validation may take time: bind the final checkpoint to
        // the same result bytes and verified artifact bytes collected above.
        if (output.resultContractVersion === 2) {
          const current = await readResult(stage, receipt);
          if (!current || current.resultDigest !== output.resultDigest) throw Error("EVIDENCE_CHANGED");
          for (const artifact of output.artifacts ?? []) {
            if (await artifactDigest(root, artifact.file) !== artifact.digest) throw Error("ARTIFACT_CHANGED");
          }
        }
        if (receipt.requestDigest) output.dispatch = { taskId: receipt.taskId, agentId: routedAgent, routeDigest: receipt.routeDigest!, requestDigest: receipt.requestDigest };
        await atomic(join(root, stage + ".reconciliation.json"), reconciliationRecord(receipt, routedAgent, routeRecord, "result-collected", { resultDigest: output.resultDigest, ...(output.resultContractVersion ? { resultContractVersion: output.resultContractVersion, artifacts: output.artifacts } : {}) }));
        if (catalog) output.catalog = catalog;
        if (routeRecord) output.modelRoute = routeRecord;
        if (routeRecord) try { await recordModelRouteOutcome(modelHistoryFile, {
          jobId: options.id, stage, taskType: centralStageRoutes[stage].request.taskType,
          agentId: routeRecord.agentId, provider: routeRecord.provider, modelId: routeRecord.modelId,
          outcome: "success", attempts: receipt.polls + 1, escalationCount: routeRecord.escalationCount,
          ...(routeRecord.estimatedCostUsd === null ? {} : { estimatedCostUsd: routeRecord.estimatedCostUsd }), at: new Date().toISOString(),
        }); } catch { await event(stage, "model-history-write-failed"); }
        await event(stage, "validated");
        return output;
        } catch (error) {
          const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "STAGE_EXECUTION_FAILED";
          if (routeRecord && receipt) {
            try { await recordModelRouteOutcome(modelHistoryFile, {
              jobId: options.id, stage, taskType: centralStageRoutes[stage].request.taskType,
              agentId: routeRecord.agentId, provider: routeRecord.provider, modelId: routeRecord.modelId,
              outcome: "failed", failureKind: classifyExecutionFailure(error instanceof Error ? error.message : ""),
              attempts: receipt.polls + 1, escalationCount: routeRecord.escalationCount,
              ...(routeRecord.estimatedCostUsd === null ? {} : { estimatedCostUsd: routeRecord.estimatedCostUsd }), at: new Date().toISOString(),
            }); } catch { await event(stage, "model-history-write-failed"); }
          }
          await event(stage, code);
          throw error;
        }
      }
    })), store, undefined, { pauseAfter: options.pauseAfter?.toLowerCase().replaceAll("_", "-") });
    if (options.pauseAfter && checkpoint.completed.at(-1) === options.pauseAfter.toLowerCase().replaceAll("_", "-")) {
      await atomic(join(root, "status.json"), { stage: options.pauseAfter, pipeline: workflowStages, status: "paused", pauseAfter: options.pauseAfter, publishingAuthorized: false, mergeAuthorized: false });
      await event(options.pauseAfter, "paused-after-checkpoint");
      return checkpoint;
    }
    await atomic(join(root, "status.json"), { stage: "REVIEW", pipeline: workflowStages, status: "awaiting-human-review", publishingAuthorized: false, mergeAuthorized: false });
    return checkpoint;
  } catch (error) {
    const transportFailure = error instanceof MaestriCommandError ? {
      command: `maestri ${error.command}`,
      exitCode: error.exitCode,
      stderrClass: error.stderrClass,
      nodeVersion: process.versions.node,
      maestriTerminalIdPresent: Boolean(process.env.MAESTRI_TERMINAL_ID),
      maestriCliConfigured: Boolean(process.env.MAESTRI_CLI),
    } : undefined;
    await options.authorize?.();
    const failureEvent = { at: new Date().toISOString(), action: "controller-failed", step: activeStep, error: error instanceof Error ? error.message : "FAILED", ...(transportFailure ? { transportFailure } : {}) };
    if(options.audit) await options.audit(failureEvent);
    else await appendFile(join(root, "events.jsonl"), JSON.stringify(failureEvent) + "\n");
    await atomic(join(root, "failure.json"), { at: new Date().toISOString(), step: activeStep, error: error instanceof Error ? error.message : "FAILED", ...(transportFailure ? { transportFailure } : {}), recovery: "Resume the same job; never resend an ambiguous dispatch automatically." });
    let current: unknown;
    try { current = JSON.parse(await bounded(join(root, "status.json"))); } catch { current = {}; }
    await atomic(join(root, "status.json"), { ...(current as object), status: "failed", publishingAuthorized: false, mergeAuthorized: false });
    throw error;
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

/** Backward-compatible synthetic entry; production callers supply a workflow. */
export const runCentralDemo = runCentralWorkflow;
