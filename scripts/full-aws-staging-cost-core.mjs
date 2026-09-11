import assert from "node:assert/strict";

export function validateFullAwsStagingCostModel(model) {
  assert.equal(model.account, "559054714699");
  assert.equal(model.region, "us-east-1");
  assert.equal(model.ceilingCents, 12500);
  const projected = Object.values(model.componentsCents ?? {}).reduce((sum, value) => {
    assert.ok(Number.isInteger(value) && value >= 0);
    return sum + value;
  }, 0);
  assert.equal(projected, model.projectedTotalCents);
  assert.equal(model.withinApprovedCeiling, projected <= model.ceilingCents);
  assert.equal(model.headroomCents, model.ceilingCents - projected);
  return Object.freeze({ projectedCents: projected, ceilingCents: model.ceilingCents, headroomCents: model.ceilingCents - projected, withinApprovedCeiling: projected <= model.ceilingCents });
}
