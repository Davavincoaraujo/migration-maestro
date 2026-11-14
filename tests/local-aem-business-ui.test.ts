import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLocalAem } from "../src/integrations/local-aem-status.js";
import { startReviewServer } from "../src/workbench/review-server.js";

test("local AEM connection is opt-in and rejects unsafe destinations", async () => {
  assert.equal((await checkLocalAem({})).state, "not-configured");
  for (const address of [
    "https://example.com/sites.html/content/demo",
    "http://localhost:4503/sites.html/content/demo",
    "http://user:pass@localhost:4502/sites.html/content/demo",
    "http://127.0.0.1:4502/system/console",
  ]) {
    assert.equal((await checkLocalAem({ MAESTRO_AEM_AUTHOR_URL: address })).state, "unavailable");
  }
});

test("business dashboard and AEM status page explain scope without exposing credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-business-ui-"));
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
    const home = await (await fetch(base)).text();
    assert.match(home, /Páginas no lote/);
    assert.match(home, /Aguardando aprovação/);
    assert.match(home, /Conexão AEM/);
    const status = await fetch(base + "/aem/status");
    assert.equal(status.status, 200);
    const json = await status.json() as { configured: boolean };
    assert.equal(typeof json.configured, "boolean");
    const view = await (await fetch(base + "/aem/status/view")).text();
    assert.match(view, /não lê páginas e não publica conteúdo/);
    assert.equal((await fetch(base + "/aem/status", { method: "POST" })).status, 403);
  } finally {
    await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done()));
    await rm(dir, { recursive: true, force: true });
  }
});
