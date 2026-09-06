import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("remaining command module cards consume their individual presentation toggles", async () => {
  const [dashboard, operations] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/app/components/CommandOperationsPanel.tsx", "utf8"),
  ]);

  for (const key of [
    "certification_readiness",
    "equipment_readiness",
    "firearm_reliability",
  ]) {
    assert.match(dashboard, new RegExp(`command_dashboard_cards\\.${key}`));
  }
  assert.match(operations, /command_dashboard_cards\.agency_training/);
  assert.match(operations, /command_dashboard_cards\.fleet_readiness/);
  assert.match(operations, /agencyTrainingEnabled &&/);
  assert.match(operations, /fleetEnabled &&/);
  assert.match(operations, /agencyTraining\.available/);
  assert.match(operations, /fleet\.available/);
});

test("command presentation settings drive operations and upcoming range list sizes", async () => {
  const [dashboard, operations, route] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/app/components/CommandOperationsPanel.tsx", "utf8"),
    readFile("src/app/api/command-dashboard/operations/route.ts", "utf8"),
  ]);

  assert.match(dashboard, /slice\(0, analyticsDashboard\.upcoming_range_days_item_limit\)/);
  assert.match(operations, /configuration\.command_operations_attention_item_limit/);
  assert.match(operations, /configuration\.command_training_upcoming_window_days/);
  assert.match(route, /mapCurrentRules\(rulesRow\)\.analytics_dashboard/);
  assert.match(route, /buildCommandOperationsPresentation/);
});
