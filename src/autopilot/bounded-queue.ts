export interface QueueOptions {
  concurrency: number;
  maxJobs: number;
  signal?: AbortSignal;
}
export type QueueOutcome<T> =
  | { index: number; status: "fulfilled"; value: T }
  | { index: number; status: "rejected"; reason: string }
  | { index: number; status: "cancelled" };
/**
 * In-process bounded queue. Each task receives the cancellation signal.
 * Cancellation prevents pending jobs from starting, but cannot forcibly stop
 * already-running tasks that ignore the signal.
 */
export async function runBoundedQueue<T>(
  tasks: readonly ((signal: AbortSignal) => Promise<T>)[],
  options: QueueOptions,
): Promise<QueueOutcome<T>[]> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32 ||
      !Number.isSafeInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 10000 ||
      tasks.length > options.maxJobs) throw new Error("Invalid queue limits");
  const signal = options.signal ?? new AbortController().signal;
  const results: QueueOutcome<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next++;
      if (signal.aborted) {
        results[index] = { index, status: "cancelled" };
        continue;
      }
      try {
        const value = await tasks[index](signal);
        results[index] = { index, status: "fulfilled", value };
      } catch {
        results[index] = { index, status: "rejected", reason: "task-failed" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, tasks.length) }, () => worker()));
  return results;
}
