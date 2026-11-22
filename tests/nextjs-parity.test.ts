import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAutopilotProgress } from "../src/autopilot/progress-reader.js";

test("Next.js blockers are separate from completed HTML pilot, sanitized and bound to baseline hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nextjs-parity-"));
  const id = "c".repeat(20), dir = join(root, id);
  try {
    await mkdir(dir);
    await writeFile(join(dir, "status.json"), JSON.stringify({ stage: "REVIEW", status: "awaiting-human-review" }));
    const digests: Record<string, string> = {};
    for (const name of ["source.json", "index.html", "built.index.html", "inventory.json", "mapping.json"]) {
      await writeFile(join(dir, name), "fixture");
      digests[name] = createHash("sha256").update("fixture").digest("hex");
    }
    const report = {
      schema: "nextjs-parity-v1", pilotId: id, status: "blocked",
      checks: { build: "blocked", typecheck: "not-run", tests: "not-run", accessibility: "blocked", screenshots: "not-run" },
      gaps: ["agent-ipc", "content-omissions"], baselineDigests: digests,
      rawEvidence: "SECRET_SOURCE_DO_NOT_EXPOSE"
    };
    const save = (v: unknown) => writeFile(join(dir, "nextjs-parity.json"), JSON.stringify(v));
    await save(report);
    const rows = await readAutopilotProgress(root);
    assert.equal(rows[0].status, "awaiting-human-review");
    assert.equal(rows[0].nextjs?.status, "blocked");
    assert.equal(rows[0].publishingAuthorized, false);
    assert.doesNotMatch(JSON.stringify(rows), /SECRET_SOURCE/);
    assert.equal(rows[0].nextjs?.gaps.includes("agent-ipc"), true);
    assert.equal(rows[0].nextjs?.accessibility, "blocked");
    await save({ ...report, gaps: ["<script>bad</script>"] });
    assert.equal((await readAutopilotProgress(root))[0].nextjs, undefined);
    await save({ ...report, status: "awaiting-human-review" });
    assert.equal((await readAutopilotProgress(root))[0].nextjs, undefined);
    await save({ ...report, pilotId: "d".repeat(20) });
    assert.equal((await readAutopilotProgress(root))[0].nextjs, undefined);
    await save(report);
    await writeFile(join(dir, "index.html"), "changed");
    assert.equal((await readAutopilotProgress(root))[0].nextjs, undefined);
    await writeFile(join(dir, "index.html"), "fixture");
    await rm(join(dir, "nextjs-parity.json"));
    await writeFile(join(root, "outside.json"), JSON.stringify(report));
    await symlink(join(root, "outside.json"), join(dir, "nextjs-parity.json"));
    assert.equal((await readAutopilotProgress(root))[0].nextjs, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
