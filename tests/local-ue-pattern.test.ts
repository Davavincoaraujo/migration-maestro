import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runUePatternReadOnly, uePatternConfig, verifyUePattern } from "../src/integrations/local-ue-pattern.js";

test("ue-pattern requires explicit absolute local configuration", () => {
  assert.equal(uePatternConfig({}), null);
  assert.throws(() => uePatternConfig({ MAESTRO_UE_PATTERN_DIR: "relative", MAESTRO_COMPONENTS_PROJECT_DIR: "/tmp/project" }));
});
test("ue-pattern adapter invokes allowlisted read-only CLI without shell", async () => {
  const base = await mkdtemp(join(tmpdir(), "maestro-ue-"));
  const cliRoot = join(base, "ue-pattern");
  const project = join(base, "components");
  try {
    await mkdir(join(cliRoot, "dist"), { recursive: true });
    await mkdir(project);
    await writeFile(join(cliRoot, "dist", "cli.js"), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const config = { cliDirectory: cliRoot, projectDirectory: project };
    assert.ok((await verifyUePattern(config)).cli.endsWith("cli.js"));
    const result = await runUePatternReadOnly(config, "buscar", "teste");
    assert.deepEqual(JSON.parse(result.output), ["buscar", "teste", "--projeto", await realpath(project)]);
    await assert.rejects(runUePatternReadOnly(config, "validar", "../outside"));
    await assert.rejects(runUePatternReadOnly(config, "buscar", "bad\ninput"));
    await assert.rejects(runUePatternReadOnly(config, "topicos", "unexpected"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
