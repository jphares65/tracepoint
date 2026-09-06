import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTrendChange,
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  normalizeAnalyticsDashboardConfiguration,
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
