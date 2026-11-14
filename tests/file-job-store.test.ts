import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileJobStore } from "../src/autopilot/file-job-store.js";
import type { JobRecord } from "../src/autopilot/job.js";

test("persists and reloads a job from a new store instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-store-"));
  try {
    const record: JobRecord = { id: "a".repeat(20), state: "running", sourcePath: "/synthetic", events: [] };
    await new FileJobStore(dir).put(record);
    const restored = await new FileJobStore(dir).get(record.id);
    assert.deepEqual(restored, record);
    const raw = await readFile(join(dir, record.id + ".json"), "utf8");
    assert.equal(JSON.parse(raw).state, "running");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("rejects path traversal and invalid job identifiers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-store-"));
  try {
    const store = new FileJobStore(dir);
    await assert.rejects(store.get("../outside"), /Invalid job identifier/);
    await assert.rejects(store.put({ id: "../outside", state: "queued", sourcePath: "", events: [] }), /Invalid job identifier/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
