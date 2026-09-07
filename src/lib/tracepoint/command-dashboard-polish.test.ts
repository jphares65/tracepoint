import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  normalizeAnalyticsDashboardConfiguration,
} from "./analytics-dashboard-config.ts";
import { getRoutePermissionRequirement } from "./permissions.ts";

const ADVANCED_SETTING_KEYS = [
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
] as const;

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

test("command presentation settings drive operations and upcoming event list sizes", async () => {
  const [dashboard, presentation, route] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/lib/tracepoint/command-operations.ts", "utf8"),
    readFile("src/app/api/command-dashboard/operations/route.ts", "utf8"),
  ]);

  assert.match(dashboard, /buildUpcomingOperationalEvents/);
  assert.match(dashboard, /displayConfiguration\.upcoming_range_days_item_limit/);
  assert.match(dashboard, /displayConfiguration\.command_operations_attention_item_limit/);
  assert.match(presentation, /configuration\.command_training_upcoming_window_days/);
  assert.match(route, /mapCurrentRules\(rulesRow\)\.analytics_dashboard/);
  assert.match(route, /buildCommandOperationsPresentation/);
});

test("command header and composed sections stay command-level and configurable", async () => {
  const [dashboard, operations] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/app/components/CommandOperationsPanel.tsx", "utf8"),
  ]);

  assert.doesNotMatch(dashboard, /Plan Range Day/);
  assert.doesNotMatch(dashboard, /Upcoming Range Days/);
  assert.doesNotMatch(operations, /Upcoming Agency Training/);
  assert.doesNotMatch(operations, /Training and Fleet Attention/);
  assert.match(dashboard, /Upcoming Operational Events/);
  assert.match(dashboard, /command_dashboard_section_order/);
  assert.match(dashboard, /visibleSectionKeys\.map/);
  assert.match(dashboard, /moveDashboardSection/);
  assert.match(dashboard, /Remove Section/);
  assert.match(dashboard, /command_dashboard_sections:\s*\{/);
  assert.match(dashboard, /upcoming_operational_events/);
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
  assert.match(dashboard, /Add Card \/ Section/);
  assert.match(dashboard, /command_dashboard_card_order/);
  assert.match(dashboard, /command_dashboard_section_order/);
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

test("analytics renders every supported advanced setting without filtering", async () => {
  const analytics = await readFile("src/app/analytics/page.tsx", "utf8");
  const definitionsStart = analytics.indexOf("const ADVANCED_SETTING_GROUPS");
  const definitionsEnd = analytics.indexOf("type QualificationTrend");
  const advancedSettingsStart = analytics.indexOf("<AdvancedSettings>");
  const advancedSettingsEnd = analytics.indexOf("</AdvancedSettings>");

  assert.notEqual(definitionsStart, -1);
  assert.notEqual(definitionsEnd, -1);
  assert.notEqual(advancedSettingsStart, -1);
  assert.notEqual(advancedSettingsEnd, -1);

  const definitions = analytics.slice(definitionsStart, definitionsEnd);
  const renderedAdvancedSettings = analytics.slice(
    advancedSettingsStart,
    advancedSettingsEnd,
  );
  const renderedKeys = Array.from(
    definitions.matchAll(/\bkey: "([^"]+)"/g),
    (match) => match[1],
  );

  assert.deepEqual(renderedKeys, [...ADVANCED_SETTING_KEYS]);
  assert.equal(new Set(renderedKeys).size, ADVANCED_SETTING_KEYS.length);
  assert.match(renderedAdvancedSettings, /ADVANCED_SETTING_GROUPS\.map/);
  assert.match(renderedAdvancedSettings, /group\.settings\.map/);
  assert.match(
    renderedAdvancedSettings,
    /data-advanced-setting-key=\{setting\.key\}/,
  );
  assert.doesNotMatch(renderedAdvancedSettings, /\.filter\(/);

  const normalized = normalizeAnalyticsDashboardConfiguration({});
  for (const key of ADVANCED_SETTING_KEYS) {
    assert.equal(
      Object.hasOwn(DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION, key),
      true,
      `${key} is missing from the default configuration`,
    );
    assert.equal(
      Object.hasOwn(normalized, key),
      true,
      `${key} is missing after normalization`,
    );
  }
});
