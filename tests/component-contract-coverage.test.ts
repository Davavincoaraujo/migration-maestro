import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentContractCoverage } from "../src/autopilot/component-contract-coverage.js";
import { localMigrationWorkflow } from "../src/autopilot/local-migration-workflow.js";
import type { MigrationRecord } from "../src/autopilot/natural-language-intake.js";

const inventory = { sections: [{ sourceId: "hero" }, { sourceId: "products" }] };
const gap = { sourceId: "products", reason: "Existing cards support one action only.",
  requiredContract: "Product selector with ordered multi-action items and exporter support.", evidence: ["mapper.ts exposes linkUrl, not actions[]."] };

test("coverage preserves an evidenced gap and detects silently omitted sections", () => {
  assert.deepEqual(componentContractCoverage(inventory, { sections: [{ sourceId: "hero" }], gaps: [gap] }), { ready: false, missingContracts: [gap] });
  const omitted = componentContractCoverage(inventory, { sections: [{ sourceId: "hero" }] });
  assert.equal(omitted.ready, false);
  assert.equal(omitted.missingContracts[0].sourceId, "products");
  assert.match(omitted.missingContracts[0].evidence[0], /absent/);
  assert.equal(componentContractCoverage(inventory, inventory).ready, true);
});

test("invalid, duplicate, invented and contradictory source identities cannot pass coverage", () => {
  for (const mapping of [null, { sections: [null] }, { sections: [{ sourceId: " " }] },
    { sections: [{ sourceId: "hero" }, { sourceId: "hero" }] }, { sections: [{ sourceId: "invented" }] },
    { sections: [], gaps: [{ ...gap, evidence: [] }] }, { sections: [], gaps: [gap, gap] },
    { sections: [{ sourceId: "products" }], gaps: [gap] }, { sections: [], gaps: [{ ...gap, sourceId: "invented" }] }]) {
    assert.throws(() => componentContractCoverage(inventory, mapping));
  }
  assert.throws(() => componentContractCoverage({ sections: [{ sourceId: "hero" }, { sourceId: "hero" }] }, inventory), /DUPLICATE/);
});

test("real workflow persists missing contracts and blocks implementation before network or project reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-gap-"));
  let networkCalls = 0;
  const workflow = localMigrationWorkflow({ record: { sourceUrl: "https://example.com/page.html" } as MigrationRecord,
    jobId: "gap-fixture", config: { project: root, pageRoot: "/content/site", damRoot: "/content/dam/site" },
    env: {}, fetcher: (async () => { networkCalls++; throw Error("must not reach AEM"); }) as typeof fetch });
  try {
    await writeFile(join(root, "inventory.json"), JSON.stringify(inventory));
    await writeFile(join(root, "mapping.json"), JSON.stringify({ sections: [{ sourceId: "hero" }], gaps: [gap] }));
    await assert.rejects(workflow.validate("MAP_COMPONENTS", root), /MISSING_COMPONENT_CONTRACT/);
    await assert.rejects(workflow.prepare("IMPLEMENT", root), /MISSING_COMPONENT_CONTRACT/);
    assert.equal(networkCalls, 0);
    const report = JSON.parse(await readFile(join(root, "component-contract-coverage.json"), "utf8"));
    assert.deepEqual(report, { ready: false, missingContracts: [gap] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
