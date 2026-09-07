import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getRoutePermissionRequirement } from "./permissions.ts";

test("remaining command module cards consume their individual presentation toggles", async () => {
  const [dashboard, operations] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/app/components/CommandOperationsPanel.tsx", "utf8"),
  ]);

  assert.match(dashboard, /command_dashboard_cards/);
  assert.match(dashboard, /availableCardKeys/);
  assert.match(operations, /command_dashboard_card_order\.filter/);
  assert.match(operations, /configuration\.command_dashboard_cards\[key\]/);
  assert.match(operations, /configuration\.command_dashboard_card_sizes\[key\]/);
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

  assert.match(dashboard, /slice\(0, displayConfiguration\.upcoming_range_days_item_limit\)/);
  assert.match(operations, /configuration\.command_operations_attention_item_limit/);
  assert.match(operations, /configuration\.command_training_upcoming_window_days/);
  assert.match(route, /mapCurrentRules\(rulesRow\)\.analytics_dashboard/);
  assert.match(route, /buildCommandOperationsPresentation/);
});

test("dashboard and analytics expose permission-gated visual builders with secondary settings access", async () => {
  const [visual, rangePanel, dashboard, analytics, shell, settings, legacy, layout] =
    await Promise.all([
      readFile(
        "src/app/components/VisualCustomization.tsx",
        "utf8",
      ),
      readFile(
        "src/app/settings/components/RangeQualificationRulesPanel.tsx",
        "utf8",
      ),
      readFile("src/app/command-dashboard/page.tsx", "utf8"),
      readFile("src/app/analytics/page.tsx", "utf8"),
      readFile("src/app/components/TracePointShell.tsx", "utf8"),
      readFile("src/app/settings/page.tsx", "utf8"),
      readFile("src/app/settings/command-dashboard-analytics/page.tsx", "utf8"),
      readFile(
        "src/app/settings/command-dashboard-analytics/layout.tsx",
        "utf8",
      ),
    ]);

  assert.match(visual, /normalizeAnalyticsDashboardConfiguration/);
  assert.match(visual, /\.select\("range_qualification_rules"\)/);
  assert.match(visual, /mergeAnalyticsDashboardConfiguration/);
  assert.match(visual, /Reset to default/);
  assert.doesNotMatch(rangePanel, /Dashboard & Analytics Presentation/);
  assert.doesNotMatch(rangePanel, /patchAnalyticsDashboard/);

  assert.match(dashboard, /hasPermission\("administer_department"\)/);
  assert.match(dashboard, /Customize Dashboard/);
  assert.match(dashboard, /Add Card/);
  assert.match(dashboard, /command_dashboard_card_order/);
  assert.match(analytics, /hasPermission\("administer_department"\)/);
  assert.match(analytics, /Customize Analytics/);
  assert.match(analytics, /Add Metric \/ Section/);
  assert.match(analytics, /analytics_section_order\.indexOf/);
  assert.doesNotMatch(shell, /label: "Command Dashboard & Analytics"/);
  assert.match(settings, /Dashboard Views/);
  assert.match(settings, /\/command-dashboard\?customize=dashboard/);
  assert.match(settings, /\/analytics\?customize=analytics/);
  assert.match(legacy, /Customize Operational Views/);
  assert.match(layout, /hasAnyServerPermission/);
  assert.match(layout, /"administer_department"/);
  assert.deepEqual(
    getRoutePermissionRequirement("/settings/command-dashboard-analytics"),
    { anyOf: ["administer_department"] },
  );
});
