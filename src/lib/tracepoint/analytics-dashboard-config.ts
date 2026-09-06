export type CommandDashboardCardKey =
  | "qualification_readiness"
  | "certification_readiness"
  | "equipment_readiness"
  | "range_readiness"
  | "records_health"
  | "performance_signal"
  | "firearm_reliability"
  | "agency_training"
  | "fleet_readiness";

export type CommandDashboardSectionKey =
  | "critical_attention"
  | "qualification_snapshot"
  | "module_snapshot"
  | "upcoming_range_days";

export type AnalyticsMetricKey =
  | "qualification_coverage"
  | "drill_performance"
  | "training_follow_ups"
  | "officer_watchlist";

export type AnalyticsSectionKey =
  | "qualification_trends"
  | "drill_trends"
  | "category_trends"
  | "alert_logic_guide"
  | "performance_inputs";

export type AnalyticsDashboardConfiguration = {
  command_dashboard_cards: Record<CommandDashboardCardKey, boolean>;
  command_dashboard_sections: Record<CommandDashboardSectionKey, boolean>;
  analytics_metrics: Record<AnalyticsMetricKey, boolean>;
  analytics_sections: Record<AnalyticsSectionKey, boolean>;
  trend_change_threshold: number;
  repeated_deficiency_count: number;
  command_attention_item_limit: number;
  command_training_attention_window_days: number;
  command_training_upcoming_window_days: number;
  command_fleet_attention_window_days: number;
  command_training_upcoming_item_limit: number;
  command_training_attention_item_limit: number;
  command_fleet_attention_item_limit: number;
  command_operations_attention_item_limit: number;
  upcoming_range_days_item_limit: number;
};

export const DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION: AnalyticsDashboardConfiguration = {
  command_dashboard_cards: {
    qualification_readiness: true,
    certification_readiness: true,
    equipment_readiness: true,
    range_readiness: true,
    records_health: true,
    performance_signal: true,
    firearm_reliability: true,
    agency_training: true,
    fleet_readiness: true,
  },
  command_dashboard_sections: {
    critical_attention: true,
    qualification_snapshot: true,
    module_snapshot: true,
    upcoming_range_days: true,
  },
  analytics_metrics: {
    qualification_coverage: true,
    drill_performance: true,
    training_follow_ups: true,
    officer_watchlist: true,
  },
  analytics_sections: {
    qualification_trends: true,
    drill_trends: true,
    category_trends: true,
    alert_logic_guide: true,
    performance_inputs: true,
  },
  trend_change_threshold: 1,
  repeated_deficiency_count: 2,
  command_attention_item_limit: 8,
  command_training_attention_window_days: 7,
  command_training_upcoming_window_days: 30,
  command_fleet_attention_window_days: 30,
  command_training_upcoming_item_limit: 5,
  command_training_attention_item_limit: 5,
  command_fleet_attention_item_limit: 8,
  command_operations_attention_item_limit: 8,
  upcoming_range_days_item_limit: 4,
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanMap<K extends string>(
  input: unknown,
  defaults: Record<K, boolean>,
): Record<K, boolean> {
  const candidate = objectValue(input);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof candidate[key] === "boolean" ? candidate[key] : fallback,
    ]),
  ) as Record<K, boolean>;
}

function integerWithin(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

export function normalizeAnalyticsDashboardConfiguration(
  input: unknown,
): AnalyticsDashboardConfiguration {
  const candidate = objectValue(input);

  return {
    command_dashboard_cards: booleanMap(
      candidate.command_dashboard_cards,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_cards,
    ),
    command_dashboard_sections: booleanMap(
      candidate.command_dashboard_sections,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_dashboard_sections,
    ),
    analytics_metrics: booleanMap(
      candidate.analytics_metrics,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.analytics_metrics,
    ),
    analytics_sections: booleanMap(
      candidate.analytics_sections,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.analytics_sections,
    ),
    trend_change_threshold: integerWithin(
      candidate.trend_change_threshold,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.trend_change_threshold,
      0,
      100,
    ),
    repeated_deficiency_count: integerWithin(
      candidate.repeated_deficiency_count,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.repeated_deficiency_count,
      1,
      20,
    ),
    command_attention_item_limit: integerWithin(
      candidate.command_attention_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_attention_item_limit,
      1,
      25,
    ),
    command_training_attention_window_days: integerWithin(
      candidate.command_training_attention_window_days,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_training_attention_window_days,
      1,
      90,
    ),
    command_training_upcoming_window_days: integerWithin(
      candidate.command_training_upcoming_window_days,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_training_upcoming_window_days,
      1,
      365,
    ),
    command_fleet_attention_window_days: integerWithin(
      candidate.command_fleet_attention_window_days,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_fleet_attention_window_days,
      1,
      365,
    ),
    command_training_upcoming_item_limit: integerWithin(
      candidate.command_training_upcoming_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_training_upcoming_item_limit,
      1,
      25,
    ),
    command_training_attention_item_limit: integerWithin(
      candidate.command_training_attention_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_training_attention_item_limit,
      1,
      25,
    ),
    command_fleet_attention_item_limit: integerWithin(
      candidate.command_fleet_attention_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_fleet_attention_item_limit,
      1,
      25,
    ),
    command_operations_attention_item_limit: integerWithin(
      candidate.command_operations_attention_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.command_operations_attention_item_limit,
      1,
      25,
    ),
    upcoming_range_days_item_limit: integerWithin(
      candidate.upcoming_range_days_item_limit,
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION.upcoming_range_days_item_limit,
      1,
      20,
    ),
  };
}

export function classifyTrendChange(
  change: number,
  threshold: number,
): "Improving" | "Declining" | "Stable" {
  const normalizedThreshold = Math.max(0, Number(threshold) || 0);
  if (change < -normalizedThreshold) return "Declining";
  if (change > normalizedThreshold) return "Improving";
  return "Stable";
}

export function reachesRepeatedDeficiencyThreshold(
  deficiencyCount: number,
  threshold: number,
) {
  return deficiencyCount >= Math.max(1, Math.round(Number(threshold) || 1));
}
