import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateFullAwsStagingCostModel } from "./full-aws-staging-cost-core.mjs";

test("full-AWS staging model is internally exact and clears the authorized ceiling", async () => {
  const model = JSON.parse(await readFile(new URL("../docs/aws-native-staging-cost-model-20260910.json", import.meta.url)));
  assert.deepEqual(validateFullAwsStagingCostModel(model), {
    projectedCents: 11842,
    ceilingCents: 12500,
    headroomCents: 658,
    withinApprovedCeiling: true,
  });
});

test("rejects understated or inconsistent costs", () => {
  const base = { account: "559054714699", region: "us-east-1", ceilingCents: 12500, componentsCents: { database: 1000 }, projectedTotalCents: 1000, headroomCents: 11500, withinApprovedCeiling: true };
  assert.equal(validateFullAwsStagingCostModel(base).withinApprovedCeiling, true);
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, projectedTotalCents: 999 }));
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, componentsCents: { database: -1 } }));
  assert.throws(() => validateFullAwsStagingCostModel({ ...base, account: "265544358665" }));
});
