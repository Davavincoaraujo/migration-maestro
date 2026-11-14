import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSpecification } from "../src/analytics/specification.js";
import { executeAnalyticsLocally } from "../src/analytics/local-executor.js";
import { startReviewServer } from "../src/workbench/review-server.js";

const fixture = JSON.parse(await readFile(new URL("../examples/analytics-specification.json", import.meta.url), "utf8")) as unknown;

test("analytics requirements execute synthetic agents and reuse checkpoints safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-analytics-exec-"));
  try {
    const spec = parseSpecification(fixture);
    const events: string[] = [];
    const first = await executeAnalyticsLocally(spec, join(dir, "checkpoints"), (id, agent) => events.push(id + ":" + agent));
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].completedAgents.length, 5);
    assert.equal(first.items[1].status, "awaiting-human-review");
    assert.equal(first.aemWritePerformed, false);
    assert.equal(first.allowExternalWrites, false);
    assert.equal(events.length, 10);
    const second = await executeAnalyticsLocally(spec, join(dir, "checkpoints"));
    assert.ok(second.items.every(item => item.checkpointReused));
    spec.requirements[0].description += " updated";
    const changed = await executeAnalyticsLocally(spec, join(dir, "checkpoints"));
    assert.notEqual(first.specificationDigest, changed.specificationDigest);
    assert.ok(changed.items.every(item => !item.checkpointReused));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dashboard exposes only sanitized analytics execution status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-analytics-view-"));
  const server = await startReviewServer(dir, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server port");
    const base = "http://127.0.0.1:" + address.port;
    assert.equal((await fetch(base + "/analytics/execution")).status, 404);
    const report = await executeAnalyticsLocally(parseSpecification(fixture), join(dir, "analytics-checkpoints"));
    await writeFile(join(dir, "analytics-execution.json"), JSON.stringify(report));
    const response = await fetch(base + "/analytics/execution");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /REQ_001/);
    assert.match(html, /awaiting-human-review/);
    assert.doesNotMatch(html, /inputDigest|outputs/);
    assert.equal((await fetch(base + "/analytics/execution", { method: "POST" })).status, 403);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
