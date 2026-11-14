import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewServer } from "../src/workbench/review-server.js";
import { listMigrationIntakes, migrationPlanSteps, validateMigrationInput } from "../src/workbench/migration-intake.js";

test("migration intake validates source and destination and plans mandatory review", () => {
  assert.equal(validateMigrationInput("https://example.com/legacy", "/content/site/new").destination, "/content/site/new");
  for (const source of ["http://example.com", "http://localhost:4502", "https://127.0.0.1/x", "https://example.com/?token=abc"]) {
    assert.throws(() => validateMigrationInput(source, "/content/site/page"));
  }
  assert.throws(() => validateMigrationInput("https://example.com", "/etc/passwd"));
  assert.equal(migrationPlanSteps().at(-1), "review");
});

test("migration intake UI stores plan locally without fetching source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-intake-"));
  await writeFile(join(dir, "report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: "", jobs: [],
    summary: { total: 0, blocked: 0, reviewRequired: 0, failed: 0, cancelled: 0 },
    metrics: { completedStages: 0, stageExecutions: 0, reusedCheckpoints: 0, elapsedMs: 0, estimatedModelCostBRL: 0 },
    noAemWrites: true,
  }));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const base = "http://127.0.0.1:" + address.port;
    const page = await (await fetch(base + "/migrations/new")).text();
    assert.match(page, /Nova migração/);
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf);
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Origin: base };
    const payload = new URLSearchParams({ csrf, source: "https://example.com/legacy", destination: "/content/site/new" });
    assert.equal((await fetch(base + "/migrations/new", { method: "POST", headers, body: new URLSearchParams({ ...Object.fromEntries(payload), csrf: "invalid" }), redirect: "manual" })).status, 403);
    assert.equal((await fetch(base + "/migrations/new", { method: "POST", headers, body: payload, redirect: "manual" })).status, 303);
    const entries = await listMigrationIntakes(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "planned");
    assert.match(await (await fetch(base + "/migrations")).text(), /Planejada/);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
