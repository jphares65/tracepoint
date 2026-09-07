import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getRoutePermissionRequirement } from "./permissions.ts";

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

test("dashboard and analytics configuration has a dedicated administrator settings route", async () => {
  const [panel, rangePanel, dashboard, analytics, shell, layout] =
    await Promise.all([
      readFile(
        "src/app/settings/command-dashboard-analytics/AnalyticsDashboardSettingsPanel.tsx",
        "utf8",
      ),
      readFile(
        "src/app/settings/components/RangeQualificationRulesPanel.tsx",
        "utf8",
      ),
      readFile("src/app/command-dashboard/page.tsx", "utf8"),
      readFile("src/app/analytics/page.tsx", "utf8"),
      readFile("src/app/components/TracePointShell.tsx", "utf8"),
      readFile(
        "src/app/settings/command-dashboard-analytics/layout.tsx",
        "utf8",
      ),
    ]);

  for (const setting of [
    "command_dashboard_cards",
    "command_dashboard_sections",
    "analytics_metrics",
    "analytics_sections",
    "trend_change_threshold",
    "repeated_deficiency_count",
    "command_attention_item_limit",
    "command_training_attention_window_days",
    "command_training_upcoming_window_days",
    "command_fleet_attention_window_days",
    "command_training_upcoming_item_limit",
    "command_training_attention_item_limit",
    "command_fleet_attention_item_limit",
    "command_operations_attention_item_limit",
    "upcoming_range_days_item_limit",
  ]) {
    assert.match(panel, new RegExp(setting));
  }

  assert.match(panel, /normalizeAnalyticsDashboardConfiguration/);
  assert.match(panel, /\.select\("range_qualification_rules"\)/);
  assert.match(panel, /mergeAnalyticsDashboardConfiguration/);
  assert.doesNotMatch(rangePanel, /Dashboard & Analytics Presentation/);
  assert.doesNotMatch(rangePanel, /patchAnalyticsDashboard/);

  for (const page of [dashboard, analytics]) {
    assert.match(page, /hasPermission\("administer_department"\)/);
    assert.match(page, /href="\/settings\/command-dashboard-analytics"/);
    assert.match(page, /Configure/);
  }

  assert.match(shell, /label: "Command Dashboard & Analytics"/);
  assert.match(
    shell,
    /href: "\/settings\/command-dashboard-analytics"[\s\S]*requirement: \{ anyOf: \["administer_department"\] \}/,
  );
  assert.match(layout, /hasAnyServerPermission/);
  assert.match(layout, /"administer_department"/);
  assert.deepEqual(
    getRoutePermissionRequirement("/settings/command-dashboard-analytics"),
    { anyOf: ["administer_department"] },
  );
});
