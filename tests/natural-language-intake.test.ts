import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCompletedLocalPilot, parseMigrationIntent, readMigrationRecords, recordMigrationRequest, requestCorrectionForLatest } from "../src/autopilot/natural-language-intake.js";

const sourceUrl = "https://example.com/products/loans/index.shtm";

test("natural-language intake recognizes URL migrations and latest-migration corrections", () => {
  assert.deepEqual(parseMigrationIntent(`Migre esta URL: ${sourceUrl}`), { kind: "migrate", url: sourceUrl });
  assert.deepEqual(parseMigrationIntent("Corrija a última migração"), { kind: "correct-latest" });
  assert.deepEqual(parseMigrationIntent("Fix the last migration"), { kind: "correct-latest" });
  assert.deepEqual(parseMigrationIntent("Olá, como vai?"), { kind: "unknown" });
  assert.throws(() => parseMigrationIntent("Migre http://localhost:4502/content/page"), /INVALID_MIGRATION_URL/);
});

test("migration requests are persisted idempotently without model calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-nl-"));
  try {
    const first = await recordMigrationRequest(dir, sourceUrl);
    const repeated = await recordMigrationRequest(dir, sourceUrl);
    assert.equal(first.id, repeated.id);
    assert.equal(first.status, "queued-for-maestri-execution");
    assert.equal(first.modelChoices[0].model, null);
    assert.match(first.modelChoices[0].evidence, /deterministic/);
    assert.equal((await readMigrationRecords(dir)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("historical local pilot artifacts populate correction context without inventing a model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-pilot-"));
  const evidence = join(dir, "evidence");
  const registry = join(dir, "registry");
  await mkdir(evidence);
  try {
    await writeFile(join(evidence, "run-context.json"), JSON.stringify({ source: sourceUrl }));
    await writeFile(join(evidence, "applied-files.json"), JSON.stringify([{ file: "src/page.tsx" }]));
    await writeFile(join(evidence, "dam-upload-report.json"), JSON.stringify({ assets: [{ path: "/content/dam/site/hero.webp" }] }));
    await writeFile(join(evidence, "page-payload-reviewed.json"), JSON.stringify({ pagePath: "/content/site/page", page: { "sling:resourceType": "components/page", child: { "sling:resourceType": "components/hero" } } }));
    await writeFile(join(evidence, "pilot-1.checkpoint.json"), JSON.stringify({ completed: ["analyze", "implement", "validate"] }));
    const report = join(evidence, "final-report.json");
    await writeFile(report, JSON.stringify({ id: "pilot-1", status: "awaiting-human-review" }));
    const imported = await importCompletedLocalPilot(registry, report, evidence);
    assert.equal(imported.sourceUrl, sourceUrl);
    assert.equal(imported.aemPage, "/content/site/page");
    assert.deepEqual(imported.components.sort(), ["components/hero", "components/page"]);
    assert.deepEqual(imported.changedFiles, ["src/page.tsx"]);
    assert.deepEqual(imported.assets, ["/content/dam/site/hero.webp"]);
    assert.equal(imported.modelChoices[0].model, null);
    const corrected = await requestCorrectionForLatest(registry);
    assert.equal(corrected.correctionRequests.at(-1)?.outcome, "awaiting-review");
    assert.match(corrected.correctionRequests.at(-1)?.note ?? "", /No recorded failing evidence/);
    const persisted = JSON.parse(await readFile(join(registry, "migrations.json"), "utf8"));
    assert.equal(persisted[0].correctionRequests.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
