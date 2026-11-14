import { createHash } from "node:crypto";

export interface Checkpoint {
  version: 1;
  jobId: string;
  inputDigest: string;
  completed: string[];
  outputs: Record<string, unknown>;
  state: "running" | "awaiting-review" | "failed";
}
export interface CheckpointStore {
  get(id: string): Promise<Checkpoint | undefined>;
  put(checkpoint: Checkpoint): Promise<void>;
}
export interface PipelineStep {
  id: string;
  run(input: unknown, previous: Readonly<Record<string, unknown>>): Promise<unknown>;
}
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly items = new Map<string, Checkpoint>();
  async get(id: string): Promise<Checkpoint | undefined> {
    const value = this.items.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async put(value: Checkpoint): Promise<void> {
    this.items.set(value.jobId, structuredClone(value));
  }
}
const digest = (input: unknown): string => createHash("sha256").update(JSON.stringify(input)).digest("hex");
/**
 * Read-only / idempotent steps only. No concurrent workers or external writes.
 * Checkpoints are saved after each completed stage; a crash within a stage
 * may re-execute that stage on restart.
 */
export async function runCheckpointed(
  jobId: string,
  input: unknown,
  steps: readonly PipelineStep[],
  store: CheckpointStore,
): Promise<Checkpoint> {
  if (!/^[a-f0-9]{20}$/.test(jobId)) throw new Error("Invalid job ID");
  if (!steps.length || steps.length > 30 ||
      steps.some(s => !/^[a-z][a-z0-9-]{0,63}$/.test(s.id)) ||
      new Set(steps.map(s => s.id)).size !== steps.length) throw new Error("Invalid pipeline steps");
  const inputDigest = digest(input);
  const existing = await store.get(jobId);
  if (existing && (existing.version !== 1 || existing.inputDigest !== inputDigest ||
      existing.completed.some((id, i) => steps[i]?.id !== id))) throw new Error("Checkpoint mismatch");
  const checkpoint: Checkpoint = existing ? structuredClone(existing) :
    { version: 1, jobId, inputDigest, completed: [], outputs: Object.create(null) as Record<string, unknown>, state: "running" };
  if (checkpoint.state === "awaiting-review") return checkpoint;
  for (const step of steps.slice(checkpoint.completed.length)) {
    try {
      const output = await step.run(input, structuredClone(checkpoint.outputs));
      // Ensure data can be serialized before treating the step as durable.
      if (output === undefined) throw new Error("Undefined stage output");
      const serialized = JSON.stringify(output);
      if (serialized === undefined || serialized.length > 2_000_000) throw new Error("Stage output not serializable or too large");
      checkpoint.outputs[step.id] = JSON.parse(serialized) as unknown;
      checkpoint.completed.push(step.id);
      checkpoint.state = "running";
      await store.put(checkpoint);
    } catch {
      checkpoint.state = "failed";
      await store.put(checkpoint);
      throw new Error("Checkpointed stage failed: " + step.id);
    }
  }
  checkpoint.state = "awaiting-review";
  await store.put(checkpoint);
  return structuredClone(checkpoint);
}
