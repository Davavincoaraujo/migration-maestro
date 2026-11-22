import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maestriTransport } from "../src/integrations/maestri-central-cli.js";

async function fixture(source: string, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "maestri-transport-"));
  try {
    const path = join(dir, "cli");
    await writeFile(path, "#!" + process.execPath + "\n" + source, { mode: 0o700 });
    await run(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("transport preserves UTF-8 split across chunks, arguments and inherited context", async () => {
  await fixture(`
    if (process.argv[2] !== "check" || process.argv[3] !== "Agent with spaces") process.exit(2);
    if (process.cwd() !== ${JSON.stringify(process.cwd())}) process.exit(3);
    if (process.env.PATH !== ${JSON.stringify(process.env.PATH)}) process.exit(4);
    const bytes = Buffer.from("GPT-6.1-Sol low · project");
    const split = bytes.indexOf(0xc2) + 1;
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 50);
  `, async path => {
    assert.equal(await maestriTransport(path)("check", ["Agent with spaces"]), "GPT-6.1-Sol low · project");
  });
});

test("oversized output rejects instead of returning a truncated footer", async () => {
  await fixture('process.stdout.write("x".repeat(128001));', async path => {
    await assert.rejects(maestriTransport(path)("check", ["Hermes"]), /MAESTRI_OUTPUT_LIMIT/);
  });
});

test("stderr never becomes session text and nonzero exit fails closed", async () => {
  await fixture('process.stderr.write("GPT-6-Astra low");', async path => {
    assert.equal(await maestriTransport(path)("check", ["Hermes"]), "");
  });
  await fixture('process.stdout.write("GPT-6-Astra low"); process.exitCode = 1;', async path => {
    await assert.rejects(maestriTransport(path)("check", ["Hermes"]), /MAESTRI_COMMAND_FAILED/);
  });
});

test("timeout rejects even after apparent success text; late output is never evidence", async () => {
  await fixture('process.stdout.write("authenticated Hermes session-1"); setTimeout(() => process.stdout.write("done"), 2000);', async path => {
    await assert.rejects(maestriTransport(path, 100)("check", ["Hermes"]), /MAESTRI_TIMEOUT/);
  });
});
