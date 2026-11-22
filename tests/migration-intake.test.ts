import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigrationIntake, listMigrationIntakes, migrationPlanSteps, validateMigrationInput } from "../src/workbench/migration-intake.js";

test("migration intake validates source and destination and plans mandatory review", () => {
  assert.equal(validateMigrationInput("https://example.com/legacy", "/content/site/new").destination, "/content/site/new");
  for (const source of ["http://example.com", "http://localhost:4502", "https://127.0.0.1/x", "https://example.com/?token=abc"]) {
    assert.throws(() => validateMigrationInput(source, "/content/site/page"));
  }
  assert.throws(() => validateMigrationInput("https://example.com", "/etc/passwd"));
  assert.equal(migrationPlanSteps().at(-1), "review");
});

test("headless migration intake persists a validated plan without fetching its source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-intake-"));
  try {
    const entry = await createMigrationIntake(dir, "https://example.com/legacy", "/content/site/new");
    const entries = await listMigrationIntakes(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, entry.id);
    assert.equal(entries[0].status, "planned");
    assert.equal(entries[0].source, "https://example.com/legacy");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
