import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { verifyMapperExporterContract, type ContractSchema } from "../src/autopilot/mapper-exporter-contract.js";

const portalRoot = resolve(process.env.PORTALBRADESCO_DIR ?? "/Users/macos/Developer/iibr-fed-portalbradesco");
const sectionsRoot = join(portalRoot, "src/frontend/components/legado/emprestimos/sections");
const exporterFile = join(portalRoot, "src/server/editor/providers/aem/definitions.ts");
const readbackFile = resolve(process.env.MAESTRO_PILOT_MODEL_READBACK ?? ".local-maestro/central-demo/20261115000000000004/aem-model-readback.json");
const runnable = process.env.MAESTRO_ENABLE_PORTAL_TESTS === "1" && existsSync(sectionsRoot) && existsSync(exporterFile) && existsSync(readbackFile);

const moduleCache = new Map<string, { exports: Record<string, unknown> }>();
let componentDefinitions: Record<string, unknown>[] = [];
const portalContext = { process: { env: { NEXT_PUBLIC_AEM_ENV: "development", DAM_BASE_URL: "" } } };
function safePortalFile(path: string): string {
  const real = realpathSync(path);
  if (!real.startsWith(realpathSync(portalRoot) + "/")) throw new Error("PORTAL_TEST_IMPORT_OUTSIDE_ROOT");
  return real;
}
function resolveTs(request: string, parent: string): string {
  const base = request.startsWith("@/") ? join(portalRoot, "src", request.slice(2)) : resolve(dirname(parent), request);
  const candidates = [base, base + ".ts", join(base, "index.ts")];
  const found = candidates.find(path => existsSync(path) && path.endsWith(".ts"));
  if (!found) throw new Error("PORTAL_TEST_MODULE_NOT_FOUND");
  return safePortalFile(found);
}
function loadPortalTs(path: string): Record<string, unknown> {
  const file = safePortalFile(path);
  const cached = moduleCache.get(file);
  if (cached) return cached.exports;
  const module = { exports: {} as Record<string, unknown> };
  moduleCache.set(file, module);
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const localRequire = (request: string): unknown => {
    if (request === "@/server/cms") {
      const assets = loadPortalTs(join(portalRoot, "src/server/cms/providers/aem/assets.ts"));
      return { buildAssetUrl: assets.buildAssetUrl };
    }
    if (request === "@/common/sites/auto-registry") return { getAllComponents: () => componentDefinitions };
    if (request.startsWith("@/") || request.startsWith(".")) return loadPortalTs(resolveTs(request, file));
    throw new Error("PORTAL_TEST_RUNTIME_IMPORT_NOT_ALLOWLISTED");
  };
  const wrapper = runInNewContext(`(function(exports, require, module, __filename, __dirname) { ${compiled}\n})`, portalContext, { filename: file }) as Function;
  wrapper(module.exports, localRequire, module, file, dirname(file));
  return module.exports;
}

function schemaFor(value: unknown, depth = 0): ContractSchema {
  if (depth > 20) throw new Error("PORTAL_FIXTURE_TOO_DEEP");
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isSafeInteger(value) ? "integer" : "number" };
  if (Array.isArray(value)) {
    const shapes = new Map<string, ContractSchema>();
    for (const item of value) {
      const shape = schemaFor(item, depth + 1);
      shapes.set(JSON.stringify(shape), shape);
    }
    if (!shapes.size) shapes.set("empty-object", { type: "object", properties: {}, required: [], additionalProperties: false });
    const variants = [...shapes.values()];
    const items: ContractSchema = variants.length === 1 ? variants[0] : { type: "union", anyOf: variants };
    return { type: "array", items };
  }
  assert.ok(value && typeof value === "object", "fixtures must remain JSON values");
  const properties = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, schemaFor(child, depth + 1)]));
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function propsContractKeys(mapperFile: string): string[] {
  const source = readFileSync(mapperFile, "utf8");
  const ast = ts.createSourceFile(mapperFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Props"));
  assert.ok(declaration, `mapper Props interface is required: ${relative(portalRoot, mapperFile)}`);
  return declaration.members.flatMap(member => ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name) ? [member.name.text] : []).sort();
}

test("real portal loan mappers and AEM editor exporter satisfy contracts against captured AEM model readback", { skip: !runnable }, () => {
  const captured = JSON.parse(readFileSync(readbackFile, "utf8")) as { sections?: { id: string; type: string; version: string; data: Record<string, unknown> }[] };
  assert.ok(Array.isArray(captured.sections));
  const definitions = readdirSync(sectionsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const definitionFile = join(sectionsRoot, entry.name, "v1/definition.ts");
    const mapperFile = join(sectionsRoot, entry.name, "v1/mapper.ts");
    return { definitionFile, mapperFile, definition: loadPortalTs(definitionFile).default as Record<string, unknown> };
  });
  componentDefinitions = definitions.map(entry => entry.definition);

  const exporter = loadPortalTs(exporterFile);
  const exportedComponents = (exporter.buildUEComponentDefinitions as (groups: string[]) => { groups: { components: { id: string; plugins: { aem: { page: { resourceType: string; template: Record<string, unknown> } } } }[] }[] })(["legado/emprestimos"]);
  const exportedModels = (exporter.buildUEModelDefinitions as () => { id: string; fields: { name: string }[] }[])();
  const componentDefinitionsOut = exportedComponents.groups.flatMap(group => group.components);
  const sections = captured.sections.filter(section => definitions.some(({ definition }) => definition.name === section.type));
  assert.equal(sections.length, definitions.length, "each real loan component must be present in the captured AEM model readback");

  for (const entry of definitions) {
    const definition = entry.definition as { name: string; version: string; group: string; modelId: string; fields: { name: string }[] };
    const section = sections.find(item => item.type === definition.name && item.version === definition.version);
    assert.ok(section, `captured model readback must contain ${definition.name}@${definition.version}`);
    const resourceType = `portal-banco-bradesco/components/sections/${definition.name}`;
    const exported = componentDefinitionsOut.find(item => item.plugins.aem.page.resourceType === resourceType);
    assert.ok(exported, `actual UE exporter must register ${resourceType}`);
    assert.equal(exported.plugins.aem.page.template.sectionType, definition.name);
    assert.equal(exported.plugins.aem.page.template.version, definition.version);
    const template = exported.plugins.aem.page.template;
    const model = exportedModels.find(item => item.id === definition.modelId);
    assert.ok(model, `actual UE model exporter must expose ${definition.modelId}`);
    for (const field of definition.fields) {
      assert.ok(model.fields.some(item => item.name === field.name), `UE model ${model.id} missing field ${field.name}`);
      if (!Object.hasOwn(section.data, field.name)) {
        assert.ok(Object.hasOwn(template, field.name), `missing AEM value has no UE template default for ${field.name}`);
      }
    }

    const mapper = loadPortalTs(entry.mapperFile).default as (data: Record<string, unknown>) => Record<string, unknown>;
    const content = { ...section.data, _path: section.id };
    const props = mapper(content);
    assert.deepEqual(Object.keys(props).sort(), propsContractKeys(entry.mapperFile), `runtime mapper output differs from its Props contract for ${definition.name}`);
    const contract = verifyMapperExporterContract({
      sourceId: section.type, resourceType,
      definition: { file: relative(portalRoot, entry.definitionFile), digest: createHash("sha256").update(readFileSync(entry.definitionFile)).digest("hex") },
      mapper: { file: relative(portalRoot, entry.mapperFile), digest: createHash("sha256").update(readFileSync(entry.mapperFile)).digest("hex") },
      exporter: { file: relative(portalRoot, exporterFile), digest: createHash("sha256").update(readFileSync(exporterFile)).digest("hex") },
      contentSchema: schemaFor(content),
      modelSchema: schemaFor({ ":type": resourceType, ...content }),
      propsSchema: schemaFor(props),
      variants: [{ id: section.version, evidence: [relative(process.cwd(), readbackFile), relative(portalRoot, entry.definitionFile), relative(portalRoot, entry.mapperFile), relative(portalRoot, exporterFile)] }],
      fixtures: [{ variantId: section.version, content, model: { ":type": resourceType, ...content }, props, evidence: ["Captured AEM model readback plus runtime output of the checked-in portal mapper and UE definitions exporter."] }],
    });
    assert.equal(contract.fixtures.length, 1);
  }
});
