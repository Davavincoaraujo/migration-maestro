import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedQueue } from "../src/autopilot/bounded-queue.js";

test("respects concurrency and preserves result ordering", async () => {
  let active = 0, peak = 0;
  const tasks = Array.from({ length: 8 }, (_, index) => async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return index;
  });
  const result = await runBoundedQueue(tasks, { concurrency: 2, maxJobs: 10 });
  assert.ok(peak <= 2);
  assert.deepEqual(result.map(r => r.status === "fulfilled" ? r.value : null), [0,1,2,3,4,5,6,7]);
});
test("does not start queued work after cancellation", async () => {
  const controller = new AbortController();
  let invoked = 0;
  const tasks = Array.from({ length: 4 }, () => async () => {
    invoked++;
    controller.abort();
    return invoked;
  });
  const result = await runBoundedQueue(tasks, { concurrency: 1, maxJobs: 10, signal: controller.signal });
  assert.equal(invoked, 1);
  assert.deepEqual(result.map(r => r.status), ["fulfilled", "cancelled", "cancelled", "cancelled"]);
});
test("isolates errors and validates job cap", async () => {
  const result = await runBoundedQueue([async () => { throw new Error("private"); }, async () => 2], { concurrency: 2, maxJobs: 2 });
  assert.equal(result[0].status, "rejected");
  assert.equal(result[1].status, "fulfilled");
  await assert.rejects(runBoundedQueue([async () => 1], { concurrency: 0, maxJobs: 1 }), /Invalid queue limits/);
});
