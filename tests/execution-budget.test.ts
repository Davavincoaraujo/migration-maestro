import test from "node:test";
import assert from "node:assert/strict";
import { stageBudget } from "../src/autopilot/execution-budget.js";
test("job budgets reserve prepared/ambiguous tasks and unknown cost blocks a hard USD ceiling", () => {
  assert.equal(stageBudget({ maxDispatches: 6 }, [null, null]), undefined);
  assert.equal(stageBudget({ maxDispatches: 6, maxJobCostUsd: 2, maxStageCostUsd: 1 }, [0.75, 0.75]), 0.5);
  assert.throws(() => stageBudget({ maxDispatches: 2 }, [null, null]), /DISPATCH_BUDGET_EXHAUSTED/);
  assert.throws(() => stageBudget({ maxDispatches: 6, maxJobCostUsd: 2 }, [null]), /COST_UNKNOWN/);
  assert.throws(() => stageBudget({ maxDispatches: 6, maxJobCostUsd: 1 }, [2]), /COST_BUDGET_EXHAUSTED/);
  assert.throws(() => stageBudget({ maxDispatches: 0 }, []), /INVALID/);
});
