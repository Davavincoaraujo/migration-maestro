import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDeliveryManifest } from "../src/autopilot/delivery-manifest.js";
import type { Checkpoint } from "../src/autopilot/checkpoint-runner.js";
import { sha256 } from "../src/integrations/aem-create-only.js";
test("delivery hashes real files/evidence and preserves immutable review bundle without Git operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "delivery-bundle-"));
  try {
    const project = join(root, "project"); await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src/component.ts"), "export {};");
    const validation = JSON.stringify({ checks: [{ name: "visual", status: "unverified", evidence: "not run" }] });
    await writeFile(join(root, "validation.json"), validation);
    const checkpoint: Checkpoint = { version: 1, jobId: "a".repeat(20), inputDigest: "b".repeat(64), completed: ["validate", "review"], state: "awaiting-review", outputs: { validate: { artifacts: [{ file: "validation.json", digest: sha256(validation) }] } } };
    const options = { root, project, checkpoint, files: ["src/component.ts"] };
    const report = await writeDeliveryManifest(options);
    assert.equal(report.acceptanceVerified, false); assert.deepEqual(report.gitOperationsPerformed, []);
    const bytes = await readFile(join(root, "delivery-manifest.json"), "utf8");
    await writeDeliveryManifest(options); assert.equal(await readFile(join(root, "delivery-manifest.json"), "utf8"), bytes);
    await writeFile(join(project, "src/component.ts"), "changed");
    await assert.rejects(writeDeliveryManifest(options), /DELIVERY_MANIFEST_CHANGED/);
    assert.equal(await readFile(join(root, "delivery-manifest.json"), "utf8"), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
