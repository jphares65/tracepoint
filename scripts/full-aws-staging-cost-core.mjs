import assert from "node:assert/strict";

export function validateFullAwsStagingCostModel(model) {
  assert.equal(model.account, "559054714699");
  assert.equal(model.region, "us-east-1");
  assert.equal(model.ceilingCents, 7500);
  const incremental = Object.values(model.incrementalComponentsCents ?? {}).reduce((sum, value) => {
    assert.ok(Number.isInteger(value) && value >= 0);
    return sum + value;
  }, 0);
  const projected = model.baselineModelCents + incremental;
  assert.equal(projected, model.projectedTotalCents);
  assert.equal(model.withinApprovedCeiling, projected <= model.ceilingCents);
  return Object.freeze({ projectedCents: projected, ceilingCents: model.ceilingCents, withinApprovedCeiling: projected <= model.ceilingCents });
}
