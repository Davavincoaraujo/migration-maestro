import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeMigrationRequest } from "../src/autopilot/execute-request.js";
import { parseMigrationIntent, recordMigrationRequest, readMigrationRecords, requestCorrectionForLatest, updateMigrationRecord } from "../src/autopilot/natural-language-intake.js";
import { destinationForUrl } from "../src/autopilot/local-migration-workflow.js";

test("URL-only intake and new phrasing share the validated intent path", () => {
  for (const text of ["https://example.com/a", "Migre esta página: https://example.com/a"]) assert.deepEqual(parseMigrationIntent(text), { kind: "migrate", url: "https://example.com/a" });
  assert.equal(destinationForUrl("https://example.com/html/classic/index.shtm", "/content/site"), "/content/site/html/classic/index");
  assert.throws(() => destinationForUrl("https://example.com/a%2fb", "/content/site"));
});

test("user-reported defects schedule diagnosis with empty errors and reuse pending correction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "correction-context-"));
  try {
    await recordMigrationRequest(dir, "https://example.com/a");
    const text = "Corrija a última migração. O banner está errado e as imagens não carregam.";
    const first = await requestCorrectionForLatest(dir, text);
    const second = await requestCorrectionForLatest(dir, text);
    assert.equal(first.errors.length, 0);
    assert.equal(second.correctionRequests.length, 1);
    assert.equal(second.correctionRequests[0].request, text);
    assert.equal(second.correctionRequests[0].outcome, "blocked");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("completed migration is recovered without querying or dispatching agents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "request-reuse-"));
  try {
    const record = await recordMigrationRequest(dir, "https://example.com/a");
    record.status = "awaiting-human-review"; await updateMigrationRecord(dir, record);
    const result = await executeMigrationRequest("Migre esta página: https://example.com/a", { directory: dir, historicalDirectory: join(dir, "absent"), transport: async () => { throw Error("MUST_NOT_CALL"); } });
    assert.equal(result.executed, false); assert.equal(result.record.id, record.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("IPC failure persists a blocked request with stable recovery directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "request-blocked-"));
  try {
    const options = { directory: dir, historicalDirectory: join(dir, "absent"), transport: async () => { throw Error("MAESTRI_IPC_UNAVAILABLE"); } };
    const first = await executeMigrationRequest("Migre esta página: https://example.com/a", options);
    const resumed = await executeMigrationRequest("Migre esta página: https://example.com/a", options);
    assert.equal("blocked" in first && first.blocked, true);
    assert.equal("resumeDirectory" in first && first.resumeDirectory, "resumeDirectory" in resumed && resumed.resumeDirectory);
    assert.equal((await readMigrationRecords(dir)).length, 1);
    assert.equal(resumed.record.status, "blocked");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
