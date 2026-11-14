import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBindingManifest, verifyBoundComponent } from "../src/integrations/component-binding-resolver.js";
test("explicit unique bindings only", () => {
 assert.deepEqual(parseBindingManifest({ bindings: [{ catalogId: "catalog-1", componentPath: "principal/sections/banner/v1" }] }).bindings.length, 1);
 for (const bindings of [
  [{ catalogId: "a", componentPath: "../outside" }],
  [{ catalogId: "a", componentPath: "/absolute" }],
  [{ catalogId: "a", componentPath: "x/v1" }, { catalogId: "a", componentPath: "y/v1" }],
  [{ catalogId: "a", componentPath: "x/v1" }, { catalogId: "b", componentPath: "x/v1" }],
 ]) assert.throws(() => parseBindingManifest({ bindings }), /INVALID_BINDINGS/);
});
test("verifies actual definition in project and rejects symlink escape", async () => {
 const root = await mkdtemp(join(tmpdir(), "maestro-binding-"));
 try {
  const base = join(root, "src/frontend/components");
  const dir = join(base, "principal/sections/banner/v1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "definition.ts"), "export {};");
  const config = { cliDirectory: root, projectDirectory: root };
  assert.equal(await verifyBoundComponent(config, "principal/sections/banner/v1"), true);
  assert.equal(await verifyBoundComponent(config, "principal/sections/absent/v1"), false);
  await symlink(root, join(base, "escape"));
  assert.equal(await verifyBoundComponent(config, "escape"), false);
 } finally { await rm(root, { recursive: true, force: true }); }
});
