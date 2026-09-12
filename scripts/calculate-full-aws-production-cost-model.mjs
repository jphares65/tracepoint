import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateProductionCostModel(model) {
  assert.equal(model.format, "tracepoint-full-aws-production-cost/v1");
  assert.equal(model.account, "193644343389");
  assert.equal(model.region, "us-east-1");
  assert.equal(model.topology, "rds-multi-az");
  assert.equal(model.hoursPerMonth, 730);
  assert.equal(Object.values(model.componentsCents).reduce((sum, value) => sum + value, 0), model.steadyStateCents);
  assert.equal(model.steadyStateCents + model.fourTaskRollingDeploymentIncrementCents, model.rollingDeploymentPeakCents);
  assert.equal(model.recommendedHardBudgetCents - model.rollingDeploymentPeakCents, model.headroomOverRollingPeakCents);
  assert.ok(model.headroomOverRollingPeakCents >= Math.ceil(model.rollingDeploymentPeakCents * 0.15), "Production hard budget needs at least 15% rolling-deployment headroom");
  assert.deepEqual(model.excludedFromPermanentState, ["Supabase", "Vercel", "Brevo"]);
  assert.equal(model.observedSourceScale.authIdentities, 96);
  assert.equal(model.observedSourceScale.storageBytes, 522978);
  return model;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = validateProductionCostModel(JSON.parse(await readFile(new URL("../docs/aws-production-cost-model-20260912.json", import.meta.url), "utf8")));
  console.log(JSON.stringify({ valid: true, topology: model.topology, steadyStateUSD: model.steadyStateCents / 100, rollingDeploymentPeakUSD: model.rollingDeploymentPeakCents / 100, recommendedHardBudgetUSD: model.recommendedHardBudgetCents / 100, headroomUSD: model.headroomOverRollingPeakCents / 100 }));
}
