"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  mergeAnalyticsDashboardConfiguration,
  normalizeAnalyticsDashboardConfiguration,
  type AnalyticsDashboardConfiguration,
  type AnalyticsMetricKey,
  type AnalyticsSectionKey,
  type CommandDashboardCardKey,
  type CommandDashboardSectionKey,
} from "@/lib/tracepoint/analytics-dashboard-config";

const COMMAND_DASHBOARD_CARDS: readonly [
  CommandDashboardCardKey,
  string,
  string,
][] = [
  ["qualification_readiness", "Qualification readiness", "Show current, due, missing, failed, and overdue qualification status."],
  ["certification_readiness", "Certification readiness", "Show readiness against required agency certifications."],
  ["equipment_readiness", "Equipment readiness", "Show readiness against required equipment assignments and inspections."],
  ["range_readiness", "Range readiness", "Show upcoming range activity and packet readiness."],
  ["records_health", "Range records", "Show saved range days, roster assignments, and planned drills."],
  ["performance_signal", "Performance signal", "Show improving and declining qualification or drill trends."],
  ["firearm_reliability", "Firearm reliability", "Show active firearms and current reliability flags."],
  ["agency_training", "Agency Training", "Show agency training operations when that module is available."],
  ["fleet_readiness", "Fleet readiness", "Show fleet operations when that module is available."],
];

const COMMAND_DASHBOARD_SECTIONS: readonly [
  CommandDashboardSectionKey,
  string,
  string,
][] = [
  ["critical_attention", "Items requiring attention", "Show the consolidated list of current readiness and performance exceptions."],
  ["qualification_snapshot", "Qualification snapshot", "Show qualification-status totals."],
  ["module_snapshot", "Module snapshot", "Show quick links and summary counts for enabled modules."],
  ["upcoming_range_days", "Upcoming range days", "Show scheduled range events and packet status."],
];

const ANALYTICS_METRICS: readonly [AnalyticsMetricKey, string, string][] = [
  ["qualification_coverage", "Qualification coverage", "Show the percentage of personnel with current required qualification records."],
  ["drill_performance", "Drill performance", "Show average movement across comparable drill histories."],
  ["training_follow_ups", "Training follow-ups", "Show generated drill-performance concerns."],
  ["officer_watchlist", "Personnel requiring review", "Show the count of personnel with qualification or drill-performance signals."],
];

const ANALYTICS_SECTIONS: readonly [AnalyticsSectionKey, string, string][] = [
  ["qualification_trends", "Qualification trends", "Show personnel qualification coverage, scores, movement, and readiness status."],
  ["drill_trends", "Drill performance trends", "Show comparable drill histories and recorded deficiencies."],
  ["category_trends", "Drill category trends", "Show department-wide patterns grouped by drill category."],
  ["alert_logic_guide", "Signal explanation", "Show a plain-language explanation of the agency thresholds used by analytics."],
  ["performance_inputs", "Performance inputs", "Show which record types feed the analytics view."],
];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function Toggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <span>
        <span className="block text-sm font-semibold text-slate-200">{title}</span>
        <span className="mt-1 block max-w-2xl text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
      />
    </label>
  );
}

function QuantityInput({
  label,
  description,
  unit = "days",
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <span className="text-sm font-semibold text-slate-200">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">
        {description}
      </span>
      <span className="mt-3 flex items-center gap-2">
        <input
          type="number"
          aria-label={`${label} in ${unit}`}
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            onChange(Math.max(min, Math.min(max, parsed)));
          }}
          className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <span className="text-xs text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

function SettingsGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
      <div className="border-b border-slate-800 px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-base font-bold text-white">{title}</h2>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function AnalyticsDashboardSettingsPanel({
  departmentId,
  canAdminister,
}: {
  departmentId: string;
  canAdminister: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [configuration, setConfiguration] =
    useState<AnalyticsDashboardConfiguration>(
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
    );
  const [originalConfiguration, setOriginalConfiguration] =
    useState<AnalyticsDashboardConfiguration>(
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
    );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadConfiguration() {
      if (!departmentId) return;
      setLoading(true);
      setNotice(null);

      try {
        // Generated database types do not yet expose this existing JSON column.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("department_rules")
          .select("range_qualification_rules")
          .eq("department_id", departmentId)
          .maybeSingle();

        if (error) throw error;
        if (!active) return;

        const rangeRules = objectValue(data?.range_qualification_rules);
        const normalized = normalizeAnalyticsDashboardConfiguration(
          rangeRules.analytics_dashboard,
        );
        setConfiguration(normalized);
        setOriginalConfiguration(normalized);
      } catch (error) {
        if (!active) return;
        setNotice({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Command Dashboard and Analytics settings could not be loaded.",
        });
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadConfiguration();
    return () => {
      active = false;
    };
  }, [departmentId, supabase]);

  function patchConfiguration<K extends keyof AnalyticsDashboardConfiguration>(
    key: K,
    value: AnalyticsDashboardConfiguration[K],
  ) {
    setConfiguration((current) => ({ ...current, [key]: value }));
  }

  async function saveConfiguration() {
    if (!departmentId || !canAdminister) return;
    setSaving(true);
    setNotice(null);

    try {
      // Generated database types do not yet expose this existing JSON column.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: loadError } = await (supabase as any)
        .from("department_rules")
        .select("range_qualification_rules")
        .eq("department_id", departmentId)
        .maybeSingle();

      if (loadError) throw loadError;

      const normalized = normalizeAnalyticsDashboardConfiguration(configuration);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: saveError } = await (supabase as any)
        .from("department_rules")
        .upsert(
          {
            department_id: departmentId,
            range_qualification_rules: mergeAnalyticsDashboardConfiguration(
              data?.range_qualification_rules,
              normalized,
            ),
          },
          { onConflict: "department_id" },
        );

      if (saveError) throw saveError;

      setConfiguration(normalized);
      setOriginalConfiguration(normalized);
      setNotice({
        tone: "success",
        message: "Command Dashboard and Analytics settings saved.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Command Dashboard and Analytics settings could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    JSON.stringify(configuration) !== JSON.stringify(originalConfiguration);

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <LoaderCircle size={18} className="animate-spin text-blue-400" />
          Loading Command Dashboard and Analytics settings...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice ? (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
            notice.tone === "success"
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
              : "border-red-800 bg-red-950/30 text-red-200"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          )}
          {notice.message}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setConfiguration(originalConfiguration);
            setNotice(null);
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 disabled:opacity-40"
        >
          <RotateCcw size={14} />
          Reset
        </button>
        <button
          type="button"
          disabled={!dirty || saving || !canAdminister}
          onClick={() => void saveConfiguration()}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
        >
          {saving ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </div>

      <SettingsGroup
        eyebrow="Command Dashboard"
        title="Cards"
        description="Choose which readiness and operations cards appear on the Command Dashboard. Module availability and permissions still control whether supporting data can be shown."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {COMMAND_DASHBOARD_CARDS.map(([key, title, description]) => (
            <Toggle
              key={key}
              title={title}
              description={description}
              checked={configuration.command_dashboard_cards[key]}
              disabled={!canAdminister}
              onChange={(value) =>
                patchConfiguration("command_dashboard_cards", {
                  ...configuration.command_dashboard_cards,
                  [key]: value,
                })
              }
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        eyebrow="Command Dashboard"
        title="Sections"
        description="Choose which full-width operational sections appear below the dashboard cards."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {COMMAND_DASHBOARD_SECTIONS.map(([key, title, description]) => (
            <Toggle
              key={key}
              title={title}
              description={description}
              checked={configuration.command_dashboard_sections[key]}
              disabled={!canAdminister}
              onChange={(value) =>
                patchConfiguration("command_dashboard_sections", {
                  ...configuration.command_dashboard_sections,
                  [key]: value,
                })
              }
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        eyebrow="Analytics"
        title="Summary metrics"
        description="Choose the headline performance metrics shown at the top of Analytics."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {ANALYTICS_METRICS.map(([key, title, description]) => (
            <Toggle
              key={key}
              title={title}
              description={description}
              checked={configuration.analytics_metrics[key]}
              disabled={!canAdminister}
              onChange={(value) =>
                patchConfiguration("analytics_metrics", {
                  ...configuration.analytics_metrics,
                  [key]: value,
                })
              }
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        eyebrow="Analytics"
        title="Sections"
        description="Choose which detailed trend, category, signal-explanation, and input sections appear in Analytics."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {ANALYTICS_SECTIONS.map(([key, title, description]) => (
            <Toggle
              key={key}
              title={title}
              description={description}
              checked={configuration.analytics_sections[key]}
              disabled={!canAdminister}
              onChange={(value) =>
                patchConfiguration("analytics_sections", {
                  ...configuration.analytics_sections,
                  [key]: value,
                })
              }
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        eyebrow="Signals & Lists"
        title="Thresholds and display limits"
        description="Tune how performance movement and repeated deficiencies are classified, and how much command information appears at once."
      >
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <QuantityInput
            label="Meaningful trend change"
            description="Minimum score-point, normalized-percentage-point, or time improvement change used to label a trend improving or declining. Smaller movement remains stable."
            unit="points"
            value={configuration.trend_change_threshold}
            min={0}
            max={100}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("trend_change_threshold", value)}
          />
          <QuantityInput
            label="Repeated deficiency threshold"
            description="Number of range days with a failure, observed deficiency, or remediation recommendation before the historical pattern independently becomes high priority."
            unit="range days"
            value={configuration.repeated_deficiency_count}
            min={1}
            max={20}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("repeated_deficiency_count", value)}
          />
          <QuantityInput
            label="Command attention limit"
            description="Maximum number of items shown in the Command Dashboard attention list."
            unit="items"
            value={configuration.command_attention_item_limit}
            min={1}
            max={25}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_attention_item_limit", value)}
          />
          <QuantityInput
            label="Upcoming range-day display limit"
            description="Maximum number of scheduled range events shown in the Upcoming Range Days section."
            unit="items"
            value={configuration.upcoming_range_days_item_limit}
            min={1}
            max={20}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("upcoming_range_days_item_limit", value)}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        eyebrow="Command Operations"
        title="Windows and list limits"
        description="Control how far ahead Command Operations looks and the maximum number of Training and Fleet exceptions it displays."
      >
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          <QuantityInput
            label="Training attention window"
            description="Days ahead used to flag scheduled training that has no roster assignments."
            value={configuration.command_training_attention_window_days}
            min={1}
            max={90}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_training_attention_window_days", value)}
          />
          <QuantityInput
            label="Upcoming training window"
            description="Days ahead included in the upcoming Agency Training list."
            value={configuration.command_training_upcoming_window_days}
            min={1}
            max={365}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_training_upcoming_window_days", value)}
          />
          <QuantityInput
            label="Fleet attention window"
            description="Days ahead used to flag approaching service, inspection, and registration dates."
            value={configuration.command_fleet_attention_window_days}
            min={1}
            max={365}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_fleet_attention_window_days", value)}
          />
          <QuantityInput
            label="Upcoming training limit"
            description="Maximum events shown in the upcoming Agency Training list."
            unit="items"
            value={configuration.command_training_upcoming_item_limit}
            min={1}
            max={25}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_training_upcoming_item_limit", value)}
          />
          <QuantityInput
            label="Training attention limit"
            description="Maximum Agency Training exceptions available to Command Operations."
            unit="items"
            value={configuration.command_training_attention_item_limit}
            min={1}
            max={25}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_training_attention_item_limit", value)}
          />
          <QuantityInput
            label="Fleet attention limit"
            description="Maximum Fleet exceptions available to Command Operations."
            unit="items"
            value={configuration.command_fleet_attention_item_limit}
            min={1}
            max={25}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_fleet_attention_item_limit", value)}
          />
          <QuantityInput
            label="Combined operations limit"
            description="Maximum Training and Fleet exceptions shown together."
            unit="items"
            value={configuration.command_operations_attention_item_limit}
            min={1}
            max={25}
            disabled={!canAdminister}
            onChange={(value) => patchConfiguration("command_operations_attention_item_limit", value)}
          />
        </div>
      </SettingsGroup>
    </div>
  );
}
