import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("condition report changes status but does not assign custody", async () => {
  const route = await readFile("src/app/api/equipment/custody/route.ts", "utf8");
  const report = route.split('if (action === "report-condition") {')[1]?.split('if (asset.lifecycle_status')[0] ?? "";
  assert.match(report, /validateConditionReport/);
  assert.match(report, /lifecycle_status: "out_of_service"/);
  assert.doesNotMatch(report, /assigned_user_id:\s*context\.user\.id/);
  assert.match(report, /audit_events/);
  assert.match(route, /asset\.lifecycle_status === "out_of_service" \|\| condition !== "serviceable"/);
});
test("drill deletion is guarded by the read workspace revision", async () => {
  const route = await readFile("src/app/api/pilot/range-workspace/drills/route.ts", "utf8");
  assert.match(route, /select\("workspace,updated_at"\)/);
  assert.match(route, /eq\("updated_at", data\.updated_at\)/);
  assert.match(route, /status: 409/);
  assert.match(route, /drill_run_results/);
});
