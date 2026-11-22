import test from "node:test";
import assert from "node:assert/strict";
import { validateSyntheticPlan, type SyntheticPlanV1 } from "../src/autopilot/synthetic-plan-contract.js";
import { mapping, planFixture } from "./fixtures/synthetic-plan.js";
test("plan v1 requires complete hash-bound decisions, preserved requirements and valid test references", () => {
  const expected = { jobId: mapping.jobId, taskId: "plan-task", mappingDigest: "c".repeat(64), mapping };
  const valid = planFixture(expected.taskId, expected.mappingDigest);
  validateSyntheticPlan(valid, expected);
  const mutations: ((p: any) => void)[] = [
    p => { p.analyzeResultDigest = "bad"; }, p => { p.plannedFiles = ["script.js"]; }, p => { p.risks = []; }, p => { p.reusedComponents = ["invented"]; }, p => { delete p.dependencies; }, p => { delete p.blockers; }, p => { p.version = 2; }, p => { p.jobId = "wrong"; }, p => { p.taskId = "wrong"; }, p => { p.stage = "IMPLEMENT"; },
    p => { p.scope = "corporate"; }, p => { p.corporateReuseVerified = true; }, p => { p.implementationAuthorized = true; },
    p => { p.mappingDigest = "d".repeat(64); }, p => { p.mappingFile = "../mapping.json"; },
    p => { p.requirements.heading = "changed"; }, p => { p.semantics = []; }, p => { p.responsiveRequirements = []; },
    p => { p.knownLimitations = ["none"]; }, p => { p.decisions.pop(); }, p => { p.decisions.push(p.decisions[0]); },
    p => { p.decisions[1] = p.decisions[0]; }, p => { p.decisions[0].index = -1; }, p => { p.decisions[0].index = 99; delete p.decisions[0].source; },
    p => { p.decisions[0].source = "invented"; }, p => { p.decisions[0].decision = ""; },
    p => { p.decisions[0].testIds = ["missing"]; }, p => { p.decisions[0].acceptanceCriteria = []; },
    p => { p.proposedTests[0].status = "passed"; }, p => { p.proposedTests.push(p.proposedTests[0]); },
    p => { p.proposedTests = []; }, p => { p.acceptanceCriteria = []; }, p => { p.implementationPlan.steps = []; }, p => { p.implementationPlan.file = "script.js"; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => validateSyntheticPlan(invalid, expected), /INVALID_PLAN_CONTRACT/);
  }
  for (const value of [null, {}, [], false]) assert.throws(() => validateSyntheticPlan(value, expected));
});
