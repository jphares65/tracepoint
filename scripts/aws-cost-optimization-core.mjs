import assert from "node:assert/strict";

const sum = values => Object.values(values).reduce((total, value) => {
  assert.ok(Number.isInteger(value) && value >= 0, "Every modeled cost must be a non-negative integer number of cents");
  return total + value;
}, 0);

export function validateAwsCostOptimizationModel(model) {
  assert.equal(model.format, "tracepoint-aws-cost-optimization/v1");
  assert.equal(model.region, "us-east-1");
  assert.equal(model.hoursPerMonth, 730);
  assert.equal(sum(model.production.currentComponentsCents), model.production.currentSteadyCents);
  assert.equal(sum(model.production.optimizedComponentsCents), model.production.optimizedSteadyCents);
  assert.equal(model.production.optimizedSteadyCents + model.production.rollingExtraTaskCents, model.production.optimizedRollingPeakCents);
  assert.equal(model.production.optimizedRollingPeakCents + 80 * 11.5, model.production.optimizedRollingAndMaxStoragePeakCents);
  assert.ok(model.production.optimizedSteadyCents >= 12500 && model.production.optimizedSteadyCents <= 15000);
  assert.ok(model.production.optimizedRollingAndMaxStoragePeakCents <= 17500);
  assert.equal(model.staging.currentCents, 11842);
  assert.ok(model.staging.optimizedCents <= model.staging.authorizedCeilingCents);
  assert.equal(model.combined.currentCents, model.production.currentSteadyCents + model.staging.currentCents);
  assert.equal(model.combined.optimizedCents, model.production.optimizedSteadyCents + model.staging.optimizedCents);
  assert.equal(model.combined.savingsCents, model.combined.currentCents - model.combined.optimizedCents);
  return model;
}
