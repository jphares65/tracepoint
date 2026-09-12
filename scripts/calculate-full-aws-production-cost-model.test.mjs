import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateProductionCostModel } from "./calculate-full-aws-production-cost-model.mjs";

const model = JSON.parse(await readFile(new URL("../docs/aws-production-cost-model-20260912.json", import.meta.url), "utf8"));

test("production cost model reconciles every component and preserves provider exit", () => {
  const result = validateProductionCostModel(model);
  assert.equal(result.steadyStateCents, 26544);
  assert.equal(result.rollingDeploymentPeakCents, 29076);
  assert.equal(result.recommendedHardBudgetCents, 35000);
});

test("cost gate fails if headroom or a component is silently changed", () => {
  assert.throws(() => validateProductionCostModel({ ...model, recommendedHardBudgetCents: 28000, headroomOverRollingPeakCents: 384 }));
  assert.throws(() => validateProductionCostModel({ ...model, componentsCents: { ...model.componentsCents, cognito_essentials_96_mau: 1 } }));
});
