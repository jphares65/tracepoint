import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAwsCostOptimizationModel } from "./aws-cost-optimization-core.mjs";

test("optimized AWS model is internally exact and within the owner targets", async () => {
  const model = JSON.parse(await readFile(new URL("../docs/aws-cost-optimization-model-20260912.json", import.meta.url)));
  const validated = validateAwsCostOptimizationModel(model);
  assert.equal(validated.production.optimizedSteadyCents, 13172);
  assert.equal(validated.production.optimizedRollingPeakCents, 14438);
  assert.equal(validated.production.optimizedRollingAndMaxStoragePeakCents, 15358);
  assert.equal(validated.combined.savingsCents, 16285);
});

test("rejects a model that crosses the initial-production or hard targets", async () => {
  const model = JSON.parse(await readFile(new URL("../docs/aws-cost-optimization-model-20260912.json", import.meta.url)));
  assert.throws(() => validateAwsCostOptimizationModel({...model,production:{...model.production,optimizedSteadyCents:15001}}));
  assert.throws(() => validateAwsCostOptimizationModel({...model,production:{...model.production,optimizedRollingAndMaxStoragePeakCents:17501}}));
});
