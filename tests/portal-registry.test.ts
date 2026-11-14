import test from "node:test";
import assert from "node:assert/strict";
import { createPortalManifest, toGenericManifest } from "../src/adapters/portal-registry.js";
const hero = { group: "html/_shared", name: "hero", version: "v1", modelId: "demo-hero", definitionImport: "@/frontend/components/Hero/v1/definition", componentImport: "@/frontend/components/Hero/v1/Hero", mapperImport: "@/frontend/components/Hero/v1/mapper" };
test("preserves qualified keys and optional mapper", () => {
  const manifest = createPortalManifest([hero]);
  assert.equal(manifest.components[0].qualifiedKey, "html/_shared/hero@v1");
  assert.equal(manifest.components[0].mapperImport, hero.mapperImport);
  assert.equal(toGenericManifest(manifest).components[0].resourceType, hero.modelId);
});
test("rejects duplicate group/name@version", () => {
  assert.throws(() => createPortalManifest([hero, hero]), /Duplicate qualified key/);
});
test("allows same name/version across different groups", () => {
  assert.equal(createPortalManifest([hero, { ...hero, group: "global" }]).components.length, 2);
});
