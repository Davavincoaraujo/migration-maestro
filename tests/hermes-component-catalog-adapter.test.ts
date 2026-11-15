import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanHermesComponentCatalog } from "../src/integrations/hermes-component-catalog-adapter.js";

test("reads nested FAQ fields and statically resolves tab helper without executing TS", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-catalog-"));
  try {
    const folder = join(root, "src/frontend/components/principal/faq/v1");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "definition.ts"), `
import { tab } from "other";
const definition: ComponentDefinition = {
  modelId: "principal--faq", name: "faq", version: "v1", group: "principal",
  title: "FAQ", description: "Perguntas", icon: "help",
  fields: [tab("content", "Conteúdo"), { name: "items", label: "Itens", type: "multifield",
    fields: [{ name: "question", label: "Pergunta", type: "richtext" }] }]
};
export default definition;
`);
    await writeFile(join(folder, "mapper.ts"), "throw new Error('SHOULD_NOT_EXECUTE')");
    const result = await scanHermesComponentCatalog(root);
    assert.equal(result.total, 1);
    assert.equal(result.components[0].key, "principal/faq@v1");
    assert.equal(result.components[0].hasMapper, true);
    assert.equal(result.components[0].fields[1].fields?.[0].name, "question");
    assert.equal(result.components[0].unresolvedFields, 0);
    assert.equal(result.components[0].fields[0].type, "tab");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("duplicate qualified keys are reported", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-catalog-"));
  try {
    for (const name of ["a", "b"]) {
      const folder = join(root, "src/frontend/components/" + name);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "definition.ts"),
        'const definition: ComponentDefinition = { name:"faq",version:"v1",group:"principal",fields:[] };');
    }
    const result = await scanHermesComponentCatalog(root);
    assert.equal(result.total, 2);
    assert.ok(result.warnings.some(w => w.reason === "DUPLICATE_KEY:principal/faq@v1"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recognizes legacy helper fields and warns about organizarDialog transform", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-legacy-"));
  try {
    const folder = join(root, "src/frontend/components/legado/classic/HeroImagem/v1");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "definition.ts"), `
const definition: ComponentDefinition = {
  modelId: "legado-classic--hero-imagem", name: "hero-imagem", group: "legado/classic",
  version: "v1", title: "Hero", description: "Imagem", icon: "image",
  fields: [tabConteudo(), imageField("imagem", "Imagem", "Descrição"),
    ...dimensoesFields("imagem", "Imagem"), tabAvancado(), anchorField()]
};
export default organizarDialog(definition);
`);
    const result = await scanHermesComponentCatalog(root);
    assert.deepEqual(result.components[0].fields.map(f => f.name),
      ["tabConteudo", "imagem", "imagemLargura", "imagemAltura", "tabAvancado", "anchorId"]);
    assert.equal(result.components[0].unresolvedFields, 0);
    assert.equal(result.components[0].exportTransform, "organizarDialog");
    assert.ok(result.warnings.some(w => w.reason === "EXPORT_TRANSFORM_NOT_APPLIED:organizarDialog"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
