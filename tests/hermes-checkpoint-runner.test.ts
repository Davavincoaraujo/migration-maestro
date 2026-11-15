import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resumeHermesBatch } from "../src/integrations/hermes-checkpoint-runner.js";
import type { planHermesBatch } from "../src/integrations/hermes-batch-planner.js";

test("reuses valid checkpoints and invalidates changed metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "maestro-resume-test-"));
  let calls = 0;
  const fake = (async (pages: { id: string; route: string; components: string[] }[]) => {
    calls++;
    return {
      mode: "plan-only" as const, humanApprovalRequired: true as const,
      codeExecutionAuthorized: false as const, total: 1, planned: 1, reviewRequired: 0,
      results: [{ id: pages[0].id, status: "planned" as const, reason: "VALID",
        artifact: { kind: "migration-analysis" as const, version: 1 as const,
          summary: "Teste", components: pages[0].components, risks: [], nextSteps: [] } }]
    };
  }) as typeof planHermesBatch;
  try {
    const page = { id: "home", route: "/home", components: ["hero"] };
    const first = await resumeHermesBatch([page], dir, fake);
    assert.equal(first.executed, 1);
    const second = await resumeHermesBatch([page], dir, fake);
    assert.equal(second.reused, 1);
    assert.equal(calls, 1);
    await resumeHermesBatch([{ ...page, components: ["faq"] }], dir, fake);
    assert.equal(calls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
