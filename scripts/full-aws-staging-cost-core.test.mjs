import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateFullAwsStagingCostModel } from "./full-aws-staging-cost-core.mjs";

test("full-AWS staging model is internally exact and currently blocks deployment", async () => {
  const model = JSON.parse(await readFile(new URL("../docs/aws-native-staging-cost-model-20260910.json", import.meta.url)));
  assert.deepEqual(validateFullAwsStagingCostModel(model), {
    projectedCents: 8445,
    ceilingCents: 7500,
    withinApprovedCeiling: false,
  });
});

test("rejects understated or inconsistent costs", () => {
  const base = { account: "559054714699", region: "us-east-1", ceilingCents: 7500, baselineModelCents: 6000, incrementalComponentsCents: { database: 1000 }, projectedTotalCents: 7000, withinApprovedCeiling: true };
  assert.equal(validateFullAwsStagingCostModel(base).withinApprovedCeiling, true);
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, projectedTotalCents: 6999 }));
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, incrementalComponentsCents: { database: -1 } }));
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, account: "265544358665" }));
});
