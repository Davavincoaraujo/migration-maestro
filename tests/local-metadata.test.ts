import test from "node:test";
import assert from "node:assert/strict";
import { exportLocalMetadata } from "../src/adapters/local-metadata.js";

test("anonymizes model identifiers and collection names", () => {
  const output = exportLocalMetadata({
    modelId: "internal-company-component",
    fields: [{ name: "secretSlides", type: "multifield", model: "internal-company-slide" }],
    subItems: [{ id: "internal-company-slide", title: "Internal title", containerField: "secretSlides", fields: [] }],
  });
  const json = JSON.stringify(output);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.containers[0].name, "collection-1");
  assert.ok(!json.includes("internal-company"));
  assert.ok(!json.includes("secretSlides"));
  assert.ok(!json.includes("Internal title"));
});

test("keeps nested topology without revealing names", () => {
  const output = exportLocalMetadata({
    modelId: "root",
    fields: [{ name: "tabs", type: "multifield", model: "tab" }],
    subItems: [
      { id: "tab", title: "Tab", containerField: "tabs", fields: [{ name: "items", type: "multifield", model: "item" }] },
      { id: "item", title: "Item", containerField: "items", fields: [] },
    ],
  });
  assert.equal(output.containers[0].children.length, 1);
});
