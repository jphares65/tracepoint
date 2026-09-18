import type { AnalyticsDashboardConfiguration } from "./analytics-dashboard-config";

export type AnalyticsAdvancedSettingKey =
  | "trend_change_threshold"
  | "repeated_deficiency_count";

export type CommandDashboardAdvancedSettingKey =
  | "command_attention_item_limit"
  | "upcoming_range_days_item_limit"
  | "command_training_attention_window_days"
  | "command_training_upcoming_window_days"
  | "command_fleet_attention_window_days"
  | "command_training_upcoming_item_limit"
  | "command_training_attention_item_limit"
  | "command_fleet_attention_item_limit"
  | "command_operations_attention_item_limit";

export type AdvancedSettingDefinition<
  Key extends keyof AnalyticsDashboardConfiguration,
> = {
  key: Key;
  label: string;
  description: string;
  guidance?: string;
  unit: "days" | "items" | "points" | "range days";
  recommended: string;
  min: number;
  max: number;
};

export const ANALYTICS_ADVANCED_SETTINGS = [
  {
    key: "trend_change_threshold",
    label: "Meaningful trend change",
    description:
      "Minimum amount a score or performance measure must change before TracePoint labels the trend Improving or Declining. Smaller changes are treated as Stable.",
    guidance:
      "Lower values detect smaller changes and create more trend signals. Higher values require a larger change before a trend is identified.",
    unit: "points",
    recommended: "1",
    min: 0,
    max: 100,
  },
  {
    key: "repeated_deficiency_count",
    label: "Repeated deficiency",
    description:
      "How many separate range days with the same deficiency are needed before TracePoint treats it as a recurring pattern.",
    guidance:
      "Lower values flag patterns sooner. Higher values require more repeated evidence before escalation.",
    unit: "range days",
    recommended: "2 range days",
    min: 1,
    max: 20,
  },
] as const satisfies readonly AdvancedSettingDefinition<AnalyticsAdvancedSettingKey>[];

export const COMMAND_DASHBOARD_ADVANCED_SETTINGS = [
  {
    key: "command_attention_item_limit",
    label: "Command attention limit",
    description:
      "Maximum number of readiness or performance exceptions shown in Items Requiring Attention.",
    guidance:
      "Lower values keep the command view focused; higher values surface more exceptions at once.",
    unit: "items",
    recommended: "8 items",
    min: 1,
    max: 25,
  },
  {
    key: "upcoming_range_days_item_limit",
    label: "Upcoming operational event limit",
    description:
      "Maximum number of future operational events shown on the Command Dashboard.",
    unit: "items",
    recommended: "4 items",
    min: 1,
    max: 20,
  },
  {
    key: "command_training_attention_window_days",
    label: "Training attention window",
    description:
      "How far ahead TracePoint looks for scheduled training that may require command attention.",
    guidance:
      "Longer windows surface roster and readiness concerns earlier; shorter windows focus on near-term training.",
    unit: "days",
    recommended: "7 days",
    min: 1,
    max: 90,
  },
  {
    key: "command_training_upcoming_window_days",
    label: "Upcoming training window",
    description:
      "How many days of future Agency Training events can be considered for Upcoming Operational Events.",
    guidance:
      "This look-ahead window works with the upcoming training and operational event limits.",
    unit: "days",
    recommended: "30 days",
    min: 1,
    max: 365,
  },
  {
    key: "command_fleet_attention_window_days",
    label: "Fleet attention window",
    description:
      "How far ahead TracePoint looks for approaching service, inspection, or registration deadlines.",
    guidance:
      "Longer windows provide earlier warning; shorter windows emphasize immediate fleet deadlines.",
    unit: "days",
    recommended: "30 days",
    min: 1,
    max: 365,
  },
  {
    key: "command_training_upcoming_item_limit",
    label: "Upcoming training limit",
    description:
      "Maximum number of upcoming Agency Training events considered for the command view.",
    unit: "items",
    recommended: "5 items",
    min: 1,
    max: 25,
  },
  {
    key: "command_training_attention_item_limit",
    label: "Training attention limit",
    description:
      "Maximum number of training-related exceptions considered for Items Requiring Attention.",
    guidance:
      "The combined operations limit still caps Training and Fleet exceptions when they are brought together.",
    unit: "items",
    recommended: "5 items",
    min: 1,
    max: 25,
  },
  {
    key: "command_fleet_attention_item_limit",
    label: "Fleet attention limit",
    description:
      "Maximum number of fleet-related exceptions considered for Items Requiring Attention.",
    guidance:
      "The combined operations limit still caps Training and Fleet exceptions when they are brought together.",
    unit: "items",
    recommended: "8 items",
    min: 1,
    max: 25,
  },
  {
    key: "command_operations_attention_item_limit",
    label: "Combined operations limit",
    description:
      "Maximum total number of Training and Fleet exceptions considered together.",
    guidance:
      "This cap applies after the individual Training and Fleet limits.",
    unit: "items",
    recommended: "8 items",
    min: 1,
    max: 25,
  },
] as const satisfies readonly AdvancedSettingDefinition<CommandDashboardAdvancedSettingKey>[];
