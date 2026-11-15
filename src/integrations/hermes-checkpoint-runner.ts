import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { planHermesBatch, validatePageInputs, type PageInput, type PageOutcome, type BatchPlan } from "./hermes-batch-planner.js";
import { validateAgentArtifact } from "../adapters/hermes/artifact-validator.js";

const VERSION = "hermes-plan-only-v1";
export type ResumeResult = BatchPlan & { reused: number; executed: number; checkpointDirectory: string };
type Planner = typeof planHermesBatch;

function digest(page: PageInput): string {
  return createHash("sha256").update(JSON.stringify({ version: VERSION, page })).digest("hex");
}
function safeCachedOutcome(value: unknown, id: string): PageOutcome | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const entry = value as Record<string, unknown>;
  if (entry.id !== id || entry.status !== "planned" || entry.reason !== "VALID") return;
  const validated = validateAgentArtifact(JSON.stringify(entry.artifact));
  if (!validated.valid) return;
  return { id, status: "planned", reason: "VALID", artifact: validated.artifact };
}

/** One writer per checkpoint directory. Completed, schema-valid plans are reusable. */
export async function resumeHermesBatch(
  input: PageInput[], directory: string, planner: Planner = planHermesBatch
): Promise<ResumeResult> {
  const pages = validatePageInputs(input);
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, ".hermes-plan.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw Error("BATCH_ALREADY_RUNNING");
    throw error;
  });
  let reused = 0;
  let executed = 0;
  const results: PageOutcome[] = [];
  try {
    for (const page of pages) {
      const key = digest(page);
      const path = join(root, key + ".json");
      let cached: PageOutcome | undefined;
      try {
        const raw = await readFile(path, "utf8");
        if (raw.length <= 32768) cached = safeCachedOutcome(JSON.parse(raw), page.id);
      } catch (error) {
        if (!(error instanceof SyntaxError) &&
            (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (cached) {
        reused++;
        results.push(cached);
        continue;
      }
      executed++;
      const batch = await planner([page]);
      const outcome = batch.results[0];
      if (!outcome || outcome.id !== page.id) throw Error("INVALID_PLANNER_RESULT");
      results.push(outcome);
      if (outcome.status === "planned" && safeCachedOutcome(outcome, page.id)) {
        const temp = join(root, "." + randomUUID() + ".tmp");
        try {
          await writeFile(temp, JSON.stringify(outcome), { mode: 0o600, flag: "wx" });
          await rename(temp, path);
        } finally {
          await rm(temp, { force: true });
        }
      }
    }
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
  const planned = results.filter(r => r.status === "planned").length;
  return {
    mode: "plan-only", humanApprovalRequired: true, codeExecutionAuthorized: false,
    total: pages.length, planned, reviewRequired: pages.length - planned,
    results, reused, executed, checkpointDirectory: root
  };
}
