import test from "node:test";
import assert from "node:assert/strict";
import { proposeContent } from "../src/adapters/portal-definition.js";
const banner = {
  group: "legado/cartoes", name: "banner", version: "v1",
  modelId: "legado-cartoes--banner", title: "Cartões · Banner do topo",
  definitionImport: "@/frontend/components/Banner/v1/definition",
  componentImport: "@/frontend/components/Banner/v1/Banner",
  fields: [], subItems: [{ id: "legado-cartoes--banner-slide", title: "Banner", containerField: "slides", fields: [] }],
};
test("creates banner proposal with nested slides", () => {
  const proposal = proposeContent(banner, { properties: { trocaMs: "9000" }, children: { slides: [{ imagemDesktop: "/demo/banner.webp", alt: "Banner demonstrativo" }] } });
  assert.equal(proposal.qualifiedKey, "legado/cartoes/banner@v1");
  assert.equal(proposal.children[0].modelId, "legado-cartoes--banner-slide");
  assert.equal(proposal.children[0].properties.alt, "Banner demonstrativo");
  assert.equal(proposal.warnings.length, 0);
});
test("rejects unknown containers from proposal", () => {
  const proposal = proposeContent(banner, { children: { unexpected: [{}] } });
  assert.equal(proposal.children.length, 0);
  assert.equal(proposal.warnings.length, 1);
});
