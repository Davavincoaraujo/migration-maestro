import { runCentralDemo } from "./fixtures/verified-sessions.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationStages } from "../src/autopilot/central-controller.js";
import { localMigrationWorkflow } from "../src/autopilot/local-migration-workflow.js";
import { recordMigrationRequest } from "../src/autopilot/natural-language-intake.js";
import { fixtureContract, componentNode } from "./fixtures/mapper-exporter.js";
import { sha256 } from "../src/integrations/aem-create-only.js";
import type { MaestriTransport } from "../src/integrations/maestri-central-cli.js";

test("local workflow uses existing controller and reconciles an uncertain AEM create without duplicate writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-workflow-"));
  const project = join(dir, "portal"), runs = join(dir, "runs"), id = "c".repeat(20), root = join(runs, id);
  const definitionFile = "src/frontend/components/hero/v1/definition.ts";
  await mkdir(join(project, "src/frontend/components/hero/v1"), { recursive: true });
  await writeFile(join(project, definitionFile), 'export default {name:"hero", fields: []}');
  execFileSync("git", ["init", "-q", project]);
  const source = await readFile(join(project, definitionFile), "utf8");
  await writeFile(join(project, "src/mapper.ts"), source);
  await writeFile(join(project, "src/exporter.ts"), source);
  const record = await recordMigrationRequest(join(dir, "registry"), "https://example.com/page.html");
  let page: unknown; let posts = 0; const asks: string[] = [];
  const fetcher = (async (url, init) => {
    if (init?.method === "POST") {
      posts++;
      page = JSON.parse(String((init.body as FormData).get(":content")));
      throw Error("simulated lost response after applying write");
    }
    if (String(url).endsWith("/page.infinity.json")) return page ? Response.json(page) : new Response(null, { status: 404 });
    return Response.json({ "jcr:primaryType": "cq:Page" });
  }) as typeof fetch;
  const workflow = localMigrationWorkflow({ record, jobId: id, validationPolicy: { maxRepairs: 0, maxDurationMs: 10000, checks: [{ id: "source", command: process.execPath, args: ["-e", "require('node:assert/strict').match(require('node:fs').readFileSync('src/mapper.ts','utf8'), /hero/);"], timeoutMs: 2000 }] }, authorization: { version: 1, jobId: id, environment: "non-production", authorOrigin: "http://localhost:4502", project, pageRoot: "/content/site", damRoot: "/content/dam/site", portalEdits: true, aemCreate: true, approvedBy: "isolated fixture" }, config: { project, pageRoot: "/content/site", damRoot: "/content/dam/site" },
    env: { MAESTRO_AEM_AUTHOR_URL: "http://localhost:4502", MAESTRO_AEM_USER: "fixture", MAESTRO_AEM_PASSWORD: "fixture" }, fetcher,
    analyze: async () => ({ stage: "analyzed", tool: "fixture-only", content: [] }) });
  const artifacts: Record<string, unknown> = {
    ANALYZE: { sections: [{ sourceId: "hero" }], findings: [] },
    DISCOVER_COMPONENTS: { files: [definitionFile] },
    MAP_COMPONENTS: { sections: [{ sourceId: "hero", definitionFile, resourceType: "portal-banco-bradesco/components/sections/hero", contractFile: "hero-contract.json", nodePath: ["jcr:content", "hero"] }], template: "/conf/site/template", policies: ["/conf/site/policy"] },
    PLAN: { files: [definitionFile], tasks: ["reuse hero"] },
    IMPLEMENT: { changedFiles: [definitionFile], assets: [], page: { "jcr:primaryType": "cq:Page", "jcr:content": { "jcr:primaryType": "cq:PageContent", "cq:template": "/conf/site/template", hero: componentNode } } },
    VALIDATE: { checks: ["tests", "typecheck", "build", "nextjs", "aem-model", "dam", "desktop", "mobile", "accessibility"].map(name => ({ name, status: "unverified", evidence: "Fixture only, not live acceptance." })), limitations: ["All integration outcomes simulated."] },
  };
  const names: Record<string, string> = { ANALYZE: "inventory.json", DISCOVER_COMPONENTS: "discovery.json", MAP_COMPONENTS: "mapping.json", PLAN: "plan.json", IMPLEMENT: "implementation.json", VALIDATE: "validation.json" };
  const transport: MaestriTransport = async (command, args) => {
    if (command === "list") return ['Analytics','UE-Pattern','Hermes','Validator'].map(name => `name: "${name}"`).join("\n");
    if (command === "check") return `${args[0] === "Hermes" ? "GPT-6-Astra" : "GPT-6.1-Sol"} default · fixture`;
    const match = args[1].match(/central task ([a-f0-9-]+); stage ([A-Z_]+)/)!;
    const stage = match[2]; asks.push(stage);
    if (stage === "VALIDATE") assert.equal(args[0], "Validator");
    if (stage === "MAP_COMPONENTS") await writeFile(join(root, "hero-contract.json"), JSON.stringify(fixtureContract(definitionFile, sha256(source))));
    await writeFile(join(root, names[stage]), JSON.stringify(artifacts[stage]));
    await writeFile(join(root, stage + ".result.json"), JSON.stringify({ version: 2, jobId: id, taskId: match[1], stage, status: "completed", summary: "Fixture", evidence: ["Simulated fixture, not real integration."], artifacts: [{ file: names[stage], digest: sha256(JSON.stringify(artifacts[stage])) }] }));
    return "fixture result ready";
  };
  try {
    const options = { directory: runs, id, workflow, transport, maxPolls: 1, pollMs: 0 };
    const paused = await runCentralDemo({ ...options, pauseAfter: "PLAN" });
    assert.deepEqual(paused.completed, ["analyze", "discover-components", "map-components", "plan"]);
    assert.equal(posts, 0); assert.equal(asks.includes("IMPLEMENT"), false);
    const pauseBytes = await readFile(join(root, `${id}.checkpoint.json`), "utf8");
    await runCentralDemo({ ...options, pauseAfter: "PLAN" });
    assert.equal(await readFile(join(root, `${id}.checkpoint.json`), "utf8"), pauseBytes);
    await assert.rejects(readFile(join(root, "IMPLEMENT.route.json")), { code: "ENOENT" });
    await assert.rejects(runCentralDemo(options), /create-aem-content/);
    const checkpoint = await runCentralDemo(options);
    assert.equal(checkpoint.state, "awaiting-review");
    assert.equal(posts, 1);
    assert.deepEqual(checkpoint.completed, migrationStages.map(s => s.toLowerCase().replaceAll("_", "-")));
    assert.equal(asks.filter(s => s === "IMPLEMENT").length, 1);
    assert.equal(asks.length, 6);
    const mapped = checkpoint.outputs["map-components"] as { artifacts: { file: string }[] };
    assert.ok(mapped.artifacts.some(a => a.file === "hero-contract.json"));
    const created = JSON.parse(await readFile(join(root, "aem-create-report.json"), "utf8"));
    assert.equal(created.reconciled, true);
    const verified = JSON.parse(await readFile(join(root, "coordinator-validation.json"), "utf8"));
    assert.equal(verified.status, "passed"); assert.equal(verified.checks[0].id, "source");
    await runCentralDemo(options);
    assert.equal(posts, 1); assert.equal(asks.length, 6);
    await writeFile(join(project, definitionFile), "changed externally");
    await assert.rejects(runCentralDemo(options), /PORTAL_IMPLEMENTATION_CHANGED|CONTRACT_SOURCE_CHANGED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("correction rejects files from a verified finding without concrete evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "correction-scope-"));
  const file = "src/hero.ts";
  await mkdir(join(root, "src"));
  await writeFile(join(root, file), "export {};");
  const workflow = localMigrationWorkflow({ record: { sourceUrl: "https://example.com/page.html" } as never,
    jobId: "correction-fixture", correction: "Fix the hero", config: { project: root, pageRoot: "/content/site", damRoot: "/content/dam/site" },
    env: {}, fetcher: (async () => { throw Error("unexpected network access"); }) as typeof fetch });
  try {
    await writeFile(join(root, "implementation.json"), JSON.stringify({ changedFiles: [file], assets: [], page: {} }));
    await writeFile(join(root, "plan.json"), JSON.stringify({ files: [file] }));
    for (const evidence of [undefined, "", "   "]) {
      await writeFile(join(root, "inventory.json"), JSON.stringify({ findings: [{ verified: true, evidence, files: [file] }] }));
      await assert.rejects(workflow.validate("IMPLEMENT", root), /CORRECTION_OUTSIDE_EVIDENCED_FILES/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("contract gates reject stale sources, mismatched mappings and unknown node fields without writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-boundaries-"));
  const definitionFile = "src/definition.ts", source = 'export default {name:"hero"};';
  await mkdir(join(root, "src"));
  for (const name of ["definition", "mapper", "exporter"]) await writeFile(join(root, `src/${name}.ts`), source);
  const contract = fixtureContract(definitionFile, sha256(source));
  const mapping = { sections: [{ sourceId: "hero", definitionFile, resourceType: contract.resourceType, contractFile: "contract.json", nodePath: ["jcr:content", "hero"] }], template: "/conf/site/template", policies: ["/conf/site/policy"] };
  let network = 0;
  const workflow = localMigrationWorkflow({ record: { sourceUrl: "https://example.com/page.html" } as never, jobId: "contract-fixture",
    config: { project: root, pageRoot: "/content/site", damRoot: "/content/dam/site" },
    env: { MAESTRO_AEM_AUTHOR_URL: "http://localhost:4502", MAESTRO_AEM_USER: "fixture", MAESTRO_AEM_PASSWORD: "fixture" },
    fetcher: (async (_url, init) => { network++; assert.notEqual(init?.method, "POST"); return Response.json({ fixture: true }); }) as typeof fetch });
  const save = async (name: string, value: unknown) => writeFile(join(root, name), JSON.stringify(value));
  try {
    await save("inventory.json", { sections: [{ sourceId: "hero" }], findings: [] });
    await save("mapping.json", mapping);
    await save("contract.json", { ...contract, sourceId: "invented" });
    await assert.rejects(workflow.validate("MAP_COMPONENTS", root), /CONTRACT_MAPPING_MISMATCH/);
    await save("contract.json", contract);
    await writeFile(join(root, "src/mapper.ts"), "source changed");
    await assert.rejects(workflow.validate("MAP_COMPONENTS", root), /CONTRACT_SOURCE_CHANGED/);
    assert.equal(network, 0);
    await writeFile(join(root, "src/mapper.ts"), source);
    await save("plan.json", { files: [], tasks: ["reuse"] });
    const manifest = (hero: unknown, extra = {}) => ({ changedFiles: [], assets: [], page: { "jcr:primaryType": "cq:Page", "jcr:content": { "cq:template": mapping.template, hero, ...extra } } });
    await save("implementation.json", manifest({ ...componentNode, title: 42 }));
    await assert.rejects(workflow.validate("IMPLEMENT", root), /IMPLEMENTED_COMPONENT_CONTRACT_MISMATCH/);
    await save("implementation.json", manifest(componentNode, { unbound: componentNode }));
    await assert.rejects(workflow.validate("IMPLEMENT", root), /UNBOUND_IMPLEMENTED_COMPONENT/);
    await save("implementation.json", manifest(componentNode));
    await workflow.validate("IMPLEMENT", root);
    await writeFile(join(root, "src/exporter.ts"), "exporter changed");
    await assert.rejects(workflow.verify!(root), /CONTRACT_SOURCE_CHANGED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
