import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { maestriTransport, type MaestriTransport } from "../integrations/maestri-central-cli.js";
import { requireMaestriSessionBoundDispatch } from "../integrations/maestri-wire-contract.js";

export interface DispatchRequest {
  version: 1;
  /** Absent only on requests created before the versioned result contract. */
  resultContractVersion?: 2;
  mappingContractVersion?: 1;
  planContractVersion?: 1;
  mappingDigest?: string;
  jobId: string;
  taskId: string;
  stage: string;
  agentId: string;
  routeDigest: string;
  prompt: string;
}
/** Identity is supplied by the authorized executor; it is not delivery authentication. */
export interface DispatchExecutor {
  identity: { executorId: string; terminalId?: string; sessionId?: string };
  execute(request: Readonly<DispatchRequest>): Promise<string>;
  /** Trusted gate, required for any dispatch in a continuation directory. */
  authorize?(request: Readonly<DispatchRequest>): Promise<void>;
}
export const dispatchDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function cliDispatchExecutor(transport: MaestriTransport = maestriTransport()): DispatchExecutor {
  return {
    identity: { executorId: "official-maestri-cli", ...(process.env.MAESTRI_TERMINAL_ID ? { terminalId: process.env.MAESTRI_TERMINAL_ID } : {}) },
    execute: request => transport("ask", [request.agentId, request.prompt]),
  };
}
function file(root: string, stage: string, suffix: string) {
  if (!/^[A-Z][A-Z_]{0,63}$/.test(stage)) throw Error("INVALID_DISPATCH_STAGE");
  return join(root, stage + suffix);
}
async function read(root: string, stage: string, suffix: string) {
  const path = file(root, stage, suffix);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 256000) throw Error("INVALID_DISPATCH_RECORD");
  return JSON.parse(await readFile(path, "utf8"));
}
function validate(request: DispatchRequest) {
  if (request.version !== 1 || !/^[a-f0-9]{20}$/.test(request.jobId) ||
      (request.resultContractVersion !== undefined && request.resultContractVersion !== 2) ||
      (request.mappingContractVersion !== undefined && (request.mappingContractVersion !== 1 || request.stage !== "MAP_COMPONENTS" || request.resultContractVersion !== 2)) ||
      (request.planContractVersion !== undefined && (request.planContractVersion !== 1 || request.stage !== "PLAN" || request.resultContractVersion !== 2 || !/^[a-f0-9]{64}$/.test(request.mappingDigest ?? ""))) ||
      (request.mappingDigest !== undefined && request.planContractVersion !== 1) ||
      !/^[a-f0-9-]{36}$/.test(request.taskId) || !/^[A-Z][A-Z_]{0,63}$/.test(request.stage) ||
      typeof request.agentId !== "string" || !request.agentId.trim() || request.agentId.length > 100 ||
      !/^[a-f0-9]{64}$/.test(request.routeDigest) || typeof request.prompt !== "string" || !request.prompt || request.prompt.length > 128000) throw Error("INVALID_DISPATCH_REQUEST");
}
export async function persistDispatchRequest(root: string, request: DispatchRequest) {
  validate(request);
  await writeFile(file(root, request.stage, ".dispatch.json"), JSON.stringify(request), { flag: "wx", mode: 0o600 });
  return dispatchDigest(request);
}
/** Explicitly invoked by an authorized executor. An existing claim always prevents a resend. */
export async function executePendingDispatch(root: string, stage: string, executor: DispatchExecutor) {
  const request = await read(root, stage, ".dispatch.json") as DispatchRequest;
  validate(request);
  const jobRoot = basename(dirname(root)) === 'probes' ? dirname(dirname(root)) : root;
  try { await lstat(join(jobRoot,'analytics-probe-recovery.json')); throw Error('RECOVERED_JOB_DISPATCH_FORBIDDEN'); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  const continuation = basename(dirname(jobRoot))==='continuations' || await lstat(join(jobRoot,'continuation.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  if(continuation && !executor.authorize) throw Error('CONTINUATION_GATE_REQUIRED');
  await executor.authorize?.(Object.freeze(request));
  const task = await read(root, stage, ".task.json");
  const route = await read(root, stage, ".route.json");
  const digest = dispatchDigest(request);
  if (request.jobId !== basename(resolve(root)) || request.stage !== stage || task.taskId !== request.taskId || task.stage !== stage || task.agentId !== request.agentId ||
      task.resultContractVersion !== request.resultContractVersion ||
      task.requestDigest !== digest || task.routeDigest !== request.routeDigest ||
      dispatchDigest(route.selected ?? route.route) !== request.routeDigest) throw Error("DISPATCH_REQUEST_MISMATCH");
  const identity = executor.identity;
  // A route requiring session attestation must not fall back to unbound delivery.
  // Reject before the durable claim; caller-supplied identity is not evidence.
  if (route.selected?.operationalEvidence?.sessionAttestation) requireMaestriSessionBoundDispatch();
  if (!identity || typeof identity.executorId !== "string" || !identity.executorId.trim() ||
      Object.values(identity).some(v => typeof v !== "string" || !v.trim() || v.length > 200)) throw Error("INVALID_EXECUTOR_IDENTITY");
  const attempt = { version: 1, taskId: request.taskId, agentId: request.agentId, requestDigest: digest, identity, at: new Date().toISOString() };
  // Exclusive creation is the durable at-most-once boundary, including competing executors.
  await writeFile(file(root, stage, ".dispatch-attempt.json"), JSON.stringify(attempt), { flag: "wx", mode: 0o600 });
  let outcome: "command-returned" | "unknown" = "unknown";
  try {
    const screen = await executor.execute(Object.freeze(request));
    // Terminal output may contain unrelated history or secrets. Keep only transport size.
    await writeFile(file(root, stage, ".ask.log"), JSON.stringify({ outputBytes: Buffer.byteLength(screen), contentRetained: false }), { mode: 0o600 });
    outcome = "command-returned";
  } catch { /* A failed command may already have delivered the prompt. Never retry. */ }
  const receipt = { ...attempt, attemptDigest: dispatchDigest(attempt), outcome, finishedAt: new Date().toISOString(), deliveryVerified: false };
  await writeFile(file(root, stage, ".dispatch-receipt.json"), JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
  return receipt;
}
/** Verify provenance without claiming the CLI authenticates the author of the result. */
export async function verifyDispatch(root: string, stage: string, expected: { taskId: string; agentId?: string; routeDigest?: string; requestDigest?: string; resultContractVersion?: 2 }) {
  if (!expected.requestDigest) return; // Historical task formats remain readable.
  const request = await read(root, stage, ".dispatch.json") as DispatchRequest;
  validate(request);
  const attempt = await read(root, stage, ".dispatch-attempt.json");
  if (request.jobId !== basename(resolve(root)) || request.stage !== stage || request.taskId !== expected.taskId || request.agentId !== expected.agentId || request.routeDigest !== expected.routeDigest ||
      request.resultContractVersion !== expected.resultContractVersion ||
      dispatchDigest(request) !== expected.requestDigest || attempt.requestDigest !== expected.requestDigest ||
      attempt.taskId !== expected.taskId || attempt.agentId !== expected.agentId || !attempt.identity?.executorId) throw Error("DISPATCH_PROVENANCE_MISMATCH");
  try {
    const receipt = await read(root, stage, ".dispatch-receipt.json");
    const { attemptDigest, outcome, finishedAt, deliveryVerified, ...recordedAttempt } = receipt;
    if (attemptDigest !== dispatchDigest(attempt) || dispatchDigest(recordedAttempt) !== dispatchDigest(attempt) ||
        !["unknown", "command-returned"].includes(outcome) || typeof finishedAt !== "string" ||
        !Number.isFinite(Date.parse(finishedAt)) || deliveryVerified !== false) throw Error("DISPATCH_PROVENANCE_MISMATCH");
  } catch (error) {
    // A process can die after sending but before recording the command outcome.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return request;
}
