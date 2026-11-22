import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPilotWorkflow, validateMappings, pilotUrl, buildAndTestPilot, type MappingEvidence, type PublicSnapshot } from "../src/autopilot/public-pilot.js";
import { artifactDigest } from "../src/autopilot/central-controller.js";

const snapshot: PublicSnapshot = { url: pilotUrl, capturedAt: "2026-11-15", title: "Public fixture", scope: [], sections: [
  { id: "products", selector: "#conteudo", query: "cards", title: "Public products", headings: [], links: [], media: [] }
] };
const evidence: MappingEvidence = { sections: [{ sourceId: "products", ueKnowledgeAvailable: true, candidates: [{ id: "fixture--cards", name: "cards", score: 13, fields: ["cards"], capabilities: ["repeated-content"] }] }] };
test("mapping is grounded in available metadata and never promotes scores into verified equivalence", () => {
  const row = { sourceId: "products", candidateId: "fixture--cards", confidence: "medium", equivalence: "partial", reason: "repeated content", gaps: ["interaction unverified"] };
  assert.equal(validateMappings({ mappings: [row] }, snapshot, evidence).length, 1);
  assert.throws(() => validateMappings({ mappings: [{ ...row, candidateId: "invented--component" }] }, snapshot, evidence));
  assert.throws(() => validateMappings({ mappings: [{ ...row, equivalence: "full", confidence: "high" }] }, snapshot, evidence));
  assert.throws(() => validateMappings({ mappings: [] }, snapshot, evidence));
  assert.equal(validateMappings({ mappings: [{ ...row, candidateId: null, equivalence: "none", confidence: "low" }] }, snapshot, { sections: [] }).length, 1);
});
test("pilot inventory and plan require source coverage; hashes reject traversal and preserve binary bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-pilot-"));
  try {
    const workflow = publicPilotWorkflow(false);
    await writeFile(join(root, "source.json"), JSON.stringify(snapshot));
    await writeFile(join(root, "inventory.json"), JSON.stringify({ sections: [{ sourceId: "invented", selector: "#conteudo", observations: "fake" }] }));
    await assert.rejects(workflow.validate("ANALYZE", root), /NOT_GROUNDED/);
    await writeFile(join(root, "implementation-plan.json"), JSON.stringify({ sections: [], files: ["index.html"], requiresHumanReview: true, limitations: ["test"] }));
    await assert.rejects(workflow.validate("PLAN", root), /NOT_VERIFIABLE/);
    await assert.rejects(artifactDigest(root, "../outside"), /INVALID_ARTIFACT_PATH/);
    await writeFile(join(root, "image.png"), Buffer.from([255]));
    const first = await artifactDigest(root, "image.png");
    await writeFile(join(root, "image.png"), Buffer.from([254]));
    assert.notEqual(first, await artifactDigest(root, "image.png"));
    assert.equal(workflow.input.url, pilotUrl);
    assert.equal(workflow.input.metadataAllowed, false);
    assert.match(workflow.instructions("IMPLEMENT", root), /No publication\/merge/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("browser integration builds and renders a public fixture, blocks stale build and active content", { skip: !process.env.MAESTRO_ANALYTICS_DIR }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pilot-browser-"));
  try {
    await writeFile(join(root, "source.json"), JSON.stringify(snapshot));
    const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:1rem}a:focus-visible{outline:3px solid blue}</style></head><body><main><h1>Public fixture</h1><section id="products" data-source-id="products"><h2>Public products</h2><a href="#products">Products</a></section></main></body></html>';
    await writeFile(join(root, "index.html"), html);
    await buildAndTestPilot(root);
    await buildAndTestPilot(root, true);
    const report = JSON.parse(await readFile(join(root, "test-report.json"), "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.viewports.length, 2);
    await writeFile(join(root, "built.index.html"), html + "changed");
    await assert.rejects(buildAndTestPilot(root, true), /STALE_PILOT_BUILD/);
    await writeFile(join(root, "index.html"), html + '<script>alert(1)</script>');
    await assert.rejects(buildAndTestPilot(root), /ACTIVE_CONTENT_DENIED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
