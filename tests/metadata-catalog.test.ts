import test from "node:test";
import assert from "node:assert/strict";
import { exportLocalMetadata } from "../src/adapters/local-metadata.js";
import { buildMetadataCatalog, parseLocalMetadata } from "../src/adapters/metadata-catalog.js";

const banner = exportLocalMetadata({ modelId: "banner", fields: [{ name: "slides", type: "multifield", model: "slide" }], subItems: [{ id: "slide", title: "Slide", containerField: "slides", fields: [] }] });
test("catalog summarizes exported components", () => {
  const catalog = buildMetadataCatalog([banner]);
  assert.deepEqual(catalog.summary, { components: 1, collections: 1, maximumDepth: 1 });
  assert.equal(catalog.components[0].containers[0].parentModelId, banner.componentId);
});
test("rejects duplicate components", () => {
  assert.throws(() => buildMetadataCatalog([banner, banner]), /Duplicate component/);
});
test("rejects tampered parent relationships", () => {
  const tampered = structuredClone(banner);
  tampered.containers[0].parentModelId = "model-0000000000000000";
  assert.throws(() => parseLocalMetadata(tampered), /Invalid container relationship/);
});
test("rejects unknown schema", () => {
  assert.throws(() => parseLocalMetadata({ ...banner, schemaVersion: 2 }), /Unsupported metadata schema/);
});
