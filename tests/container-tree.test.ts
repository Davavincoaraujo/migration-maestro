import test from "node:test";
import assert from "node:assert/strict";
import { extractContainerTree } from "../src/adapters/container-tree.js";
test("detects root slide collection", () => {
  const tree = extractContainerTree({ modelId: "legado-cartoes--banner", fields: [{ name: "slides", type: "multifield", model: "legado-cartoes--banner-slide" }], subItems: [{ id: "legado-cartoes--banner-slide", title: "Banner", containerField: "slides", fields: [] }] });
  assert.equal(tree[0].name, "slides");
});
test("detects nested services under tabs", () => {
  const tree = extractContainerTree({ modelId: "root", fields: [{ name: "abas", type: "multifield", model: "aba" }], subItems: [{ id: "aba", title: "Aba", containerField: "abas", fields: [{ name: "servicos", type: "multifield", model: "servico" }] }, { id: "servico", title: "Serviço", containerField: "servicos", fields: [] }] });
  assert.equal(tree[0].children[0].name, "servicos");
});
test("rejects unresolved models", () => {
  assert.throws(() => extractContainerTree({ modelId: "root", fields: [{ name: "x", type: "multifield", model: "unknown" }] }), /Unknown container model/);
});
