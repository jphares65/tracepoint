import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  normalizeAnalyticsDashboardConfiguration,
} from "./analytics-dashboard-config.ts";
import {
  ANALYTICS_ADVANCED_SETTINGS,
  COMMAND_DASHBOARD_ADVANCED_SETTINGS,
} from "./dashboard-advanced-settings.ts";
import { getRoutePermissionRequirement } from "./permissions.ts";

const ANALYTICS_ADVANCED_SETTING_KEYS = [
  "trend_change_threshold",
  "repeated_deficiency_count",
] as const;

const COMMAND_DASHBOARD_ADVANCED_SETTING_KEYS = [
  "command_attention_item_limit",
  "upcoming_range_days_item_limit",
  "command_training_attention_window_days",
  "command_training_upcoming_window_days",
  "command_fleet_attention_window_days",
  "command_training_upcoming_item_limit",
  "command_training_attention_item_limit",
  "command_fleet_attention_item_limit",
  "command_operations_attention_item_limit",
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

test("dashboard renders all nine operational advanced controls", async () => {
  const [dashboard, visual] = await Promise.all([
    readFile("src/app/command-dashboard/page.tsx", "utf8"),
    readFile("src/app/components/VisualCustomization.tsx", "utf8"),
  ]);
  const renderedKeys = COMMAND_DASHBOARD_ADVANCED_SETTINGS.map(
    (setting) => setting.key,
  );

  assert.deepEqual(renderedKeys, [...COMMAND_DASHBOARD_ADVANCED_SETTING_KEYS]);
  assert.equal(new Set(renderedKeys).size, 9);
  assert.match(dashboard, /COMMAND_DASHBOARD_ADVANCED_SETTINGS\.map/);
  assert.match(dashboard, /<AdvancedSettingControl/);
  assert.match(
    dashboard,
    /Advanced Settings control how much operational information TracePoint surfaces to command staff\. The recommended defaults are appropriate for most agencies\./,
  );
  assert.match(visual, /data-advanced-setting-key=\{setting\.key\}/);
  assert.match(visual, /Recommended: \{setting\.recommended\}/);

  const normalized = normalizeAnalyticsDashboardConfiguration({});
  for (const key of COMMAND_DASHBOARD_ADVANCED_SETTING_KEYS) {
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

test("dashboard advanced controls include descriptions and recommended metadata", () => {
  const expectedMetadata = [
    ["Command attention limit", "Maximum number of readiness or performance exceptions shown in Items Requiring Attention.", "8 items"],
    ["Upcoming operational event limit", "Maximum number of future operational events shown on the Command Dashboard.", "4 items"],
    ["Training attention window", "How far ahead TracePoint looks for scheduled training that may require command attention.", "7 days"],
    ["Upcoming training window", "How many days of future Agency Training events can be considered for Upcoming Operational Events.", "30 days"],
    ["Fleet attention window", "How far ahead TracePoint looks for approaching service, inspection, or registration deadlines.", "30 days"],
    ["Upcoming training limit", "Maximum number of upcoming Agency Training events considered for the command view.", "5 items"],
    ["Training attention limit", "Maximum number of training-related exceptions considered for Items Requiring Attention.", "5 items"],
    ["Fleet attention limit", "Maximum number of fleet-related exceptions considered for Items Requiring Attention.", "8 items"],
    ["Combined operations limit", "Maximum total number of Training and Fleet exceptions considered together.", "8 items"],
  ];

  assert.deepEqual(
    COMMAND_DASHBOARD_ADVANCED_SETTINGS.map(
      ({ label, description, recommended }) => [
        label,
        description,
        recommended,
      ],
    ),
    expectedMetadata,
  );
  for (const setting of COMMAND_DASHBOARD_ADVANCED_SETTINGS) {
    assert.ok(setting.description.length > 0);
    assert.ok(setting.recommended.length > 0);
    assert.ok(setting.unit.length > 0);
  }
});

test("analytics keeps only analytics-specific advanced controls", async () => {
  const analytics = await readFile("src/app/analytics/page.tsx", "utf8");
  const analyticsKeys = ANALYTICS_ADVANCED_SETTINGS.map((setting) => setting.key);

  assert.deepEqual(analyticsKeys, [...ANALYTICS_ADVANCED_SETTING_KEYS]);
  assert.deepEqual(
    ANALYTICS_ADVANCED_SETTINGS.map(({ label }) => label),
    ["Meaningful trend change", "Repeated deficiency"],
  );
  assert.match(analytics, /ANALYTICS_ADVANCED_SETTINGS\.map/);
  assert.match(analytics, /<AdvancedSettingControl/);
  assert.doesNotMatch(analytics, /COMMAND_DASHBOARD_ADVANCED_SETTINGS/);
  for (const key of COMMAND_DASHBOARD_ADVANCED_SETTING_KEYS) {
    assert.doesNotMatch(analytics, new RegExp(key));
  }

  const dashboardKeys = new Set<string>(COMMAND_DASHBOARD_ADVANCED_SETTING_KEYS);
  assert.equal(analyticsKeys.some((key) => dashboardKeys.has(key)), false);
});
