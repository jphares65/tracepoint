import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTrendChange,
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  mergeAnalyticsDashboardConfiguration,
  normalizeAnalyticsDashboardConfiguration,
  resetAnalyticsDashboardConfiguration,
  reachesRepeatedDeficiencyThreshold,
} from "./analytics-dashboard-config.ts";

test("preserves the current dashboard and analytics experience by default", () => {
  assert.deepEqual(
    normalizeAnalyticsDashboardConfiguration(undefined),
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  );
  assert.ok(
    Object.values(
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_cards,
    ).every(Boolean),
  );
  assert.ok(
    Object.values(
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.analytics_sections,
    ).every(Boolean),
  );
});

test("applies agency trend and repeated-deficiency thresholds at their boundaries", () => {
  assert.equal(classifyTrendChange(2, 2), "Stable");
  assert.equal(classifyTrendChange(2.1, 2), "Improving");
  assert.equal(classifyTrendChange(-2.1, 2), "Declining");
  assert.equal(reachesRepeatedDeficiencyThreshold(2, 3), false);
  assert.equal(reachesRepeatedDeficiencyThreshold(3, 3), true);
});

test("accepts known visibility preferences without allowing unknown keys", () => {
  const normalized = normalizeAnalyticsDashboardConfiguration({
    command_dashboard_cards: {
      qualification_readiness: false,
      invented_card: false,
    },
    analytics_sections: {
      drill_trends: false,
    },
  });

  assert.equal(normalized.command_dashboard_cards.qualification_readiness, false);
  assert.equal(normalized.command_dashboard_cards.range_readiness, true);
  assert.equal(normalized.analytics_sections.drill_trends, false);
  assert.equal("invented_card" in normalized.command_dashboard_cards, false);
});

test("normalizes saved dashboard card order, sizes, and analytics section order", () => {
  const normalized = normalizeAnalyticsDashboardConfiguration({
    command_dashboard_card_order: [
      "performance_signal",
      "qualification_readiness",
      "performance_signal",
      "invented_card",
    ],
    command_dashboard_card_sizes: {
      performance_signal: "wide",
      qualification_readiness: "enormous",
      invented_card: "compact",
    },
    analytics_section_order: [
      "performance_inputs",
      "qualification_trends",
      "performance_inputs",
      "invented_section",
    ],
  });

  assert.deepEqual(normalized.command_dashboard_card_order.slice(0, 2), [
    "performance_signal",
    "qualification_readiness",
  ]);
  assert.equal(new Set(normalized.command_dashboard_card_order).size, 9);
  assert.equal(normalized.command_dashboard_card_sizes.performance_signal, "wide");
  assert.equal(normalized.command_dashboard_card_sizes.qualification_readiness, "compact");
  assert.equal("invented_card" in normalized.command_dashboard_card_sizes, false);
  assert.deepEqual(normalized.analytics_section_order.slice(0, 2), [
    "performance_inputs",
    "qualification_trends",
  ]);
  assert.equal(new Set(normalized.analytics_section_order).size, 5);
});

test("legacy saved documents receive the recommended layout without losing visibility", () => {
  const normalized = normalizeAnalyticsDashboardConfiguration({
    command_dashboard_cards: { records_health: false },
    analytics_sections: { category_trends: false },
    trend_change_threshold: 4,
  });

  assert.deepEqual(
    normalized.command_dashboard_card_order,
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_card_order,
  );
  assert.deepEqual(
    normalized.analytics_section_order,
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.analytics_section_order,
  );
  assert.equal(normalized.command_dashboard_cards.records_health, false);
  assert.equal(normalized.analytics_sections.category_trends, false);
  assert.equal(normalized.trend_change_threshold, 4);
});

test("reset returns an independent recommended configuration", () => {
  const reset = resetAnalyticsDashboardConfiguration();
  reset.command_dashboard_card_order.reverse();
  reset.analytics_section_order.reverse();

  assert.notDeepEqual(
    reset.command_dashboard_card_order,
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_card_order,
  );
  assert.notDeepEqual(
    reset.analytics_section_order,
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.analytics_section_order,
  );
  assert.equal(
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_cards.qualification_readiness,
    true,
  );
});

test("normalizes configurable thresholds to safe supported ranges", () => {
  assert.deepEqual(
    normalizeAnalyticsDashboardConfiguration({
      trend_change_threshold: -4,
      repeated_deficiency_count: 99,
      command_attention_item_limit: 3.6,
    }),
    {
      ...DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
      trend_change_threshold: 0,
      repeated_deficiency_count: 20,
      command_attention_item_limit: 4,
    },
  );

  const invalid = normalizeAnalyticsDashboardConfiguration({
    trend_change_threshold: "not-a-number",
  });
  assert.equal(
    invalid.trend_change_threshold,
    DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.trend_change_threshold,
  );
});

test("normalizes command presentation windows and list limits while preserving defaults", () => {
  const normalized = normalizeAnalyticsDashboardConfiguration({
    command_training_attention_window_days: 0,
    command_training_upcoming_window_days: 45.4,
    command_fleet_attention_window_days: 999,
    command_training_upcoming_item_limit: 2,
    command_training_attention_item_limit: 30,
    command_fleet_attention_item_limit: "invalid",
    command_operations_attention_item_limit: 6.6,
    upcoming_range_days_item_limit: 12,
  });

  assert.equal(normalized.command_training_attention_window_days, 1);
  assert.equal(normalized.command_training_upcoming_window_days, 45);
  assert.equal(normalized.command_fleet_attention_window_days, 365);
  assert.equal(normalized.command_training_upcoming_item_limit, 2);
  assert.equal(normalized.command_training_attention_item_limit, 25);
  assert.equal(normalized.command_fleet_attention_item_limit, 8);
  assert.equal(normalized.command_operations_attention_item_limit, 7);
  assert.equal(normalized.upcoming_range_days_item_limit, 12);
});

test("relocating presentation settings preserves unrelated range-rule values", () => {
  const merged = mergeAnalyticsDashboardConfiguration(
    {
      schema_version: 7,
      require_day_handgun_qualification: false,
      remediation_due_days: 45,
      custom_future_rule: { enabled: true },
      analytics_dashboard: { trend_change_threshold: 9 },
    },
    {
      trend_change_threshold: 3,
      command_dashboard_cards: { performance_signal: false },
    },
  );

  assert.equal(merged.schema_version, 7);
  assert.equal(merged.require_day_handgun_qualification, false);
  assert.equal(merged.remediation_due_days, 45);
  assert.deepEqual(merged.custom_future_rule, { enabled: true });
  assert.equal(
    (merged.analytics_dashboard as typeof DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION)
      .trend_change_threshold,
    3,
  );
  assert.equal(
    (merged.analytics_dashboard as typeof DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION)
      .command_dashboard_cards.performance_signal,
    false,
  );
});
