"use client";

import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AdvancedSettings,
  CustomizationBar,
  ReorderButtons,
  useVisualConfigurationEditor,
} from "@/app/components/VisualCustomization";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  LineChart,
  Moon,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  normalizeAnalyticsDashboardConfiguration,
  type AnalyticsDashboardConfiguration,
  type AnalyticsMetricKey,
  type AnalyticsSectionKey,
} from "@/lib/tracepoint/analytics-dashboard-config";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type Risk = "Low" | "Medium" | "High";
type Trend = "Baseline" | "Improving" | "Stable" | "Monitor" | "Declining" | "Action Needed";

const ANALYTICS_METRIC_DETAILS: Record<AnalyticsMetricKey, string> = {
  qualification_coverage: "Qualification Coverage",
  drill_performance: "Drill Performance",
  training_follow_ups: "Training Follow-Ups",
  officer_watchlist: "Personnel Requiring Review",
};

const ANALYTICS_SECTION_DETAILS: Record<AnalyticsSectionKey, string> = {
  qualification_trends: "Qualification Trends",
  drill_trends: "Drill Performance Trends",
  category_trends: "Drill Category Trends",
  alert_logic_guide: "Signal Explanation",
  performance_inputs: "Performance Inputs",
};

type QualificationTrend = {
  officerId: string;
  name: string;
  assignment: string;
  status: string;
  dayScore: string;
  nightScore: string;
  trend: Trend;
  dayNightGap: string;
  lastQualified: string;
  risk: Risk;
  detail: string;
};

type DrillTrend = {
  officerId: string;
  name: string;
  assignment: string;
  category: string;
  drillName: string;
  trend: Trend;
  averageChange: string;
  weakArea: string;
  repeatedDeficiency: string;
  remedial: string;
  risk: Risk;
  detail: string;
};

type BroadDrillTrend = {
  category: string;
  direction: string;
  affected: string;
  detail: string;
};

type PerformanceSummary = {
  metrics: {
    qualificationCoverage: string;
    drillPerformance: string;
    trainingFollowUps: string;
    officerWatchlist: string;
  };
  qualificationTrends: QualificationTrend[];
  drillTrends: DrillTrend[];
  broadCategoryTrends: BroadDrillTrend[];
  hasWorkspaceData: boolean;
  workspaceUpdatedAt?: string | null;
  configuration: AnalyticsDashboardConfiguration;
};

const FALLBACK_SUMMARY: PerformanceSummary = {
  metrics: {
    qualificationCoverage: "—",
    drillPerformance: "—",
    trainingFollowUps: "—",
    officerWatchlist: "—",
  },
  qualificationTrends: [],
  drillTrends: [],
  broadCategoryTrends: [],
  hasWorkspaceData: false,
  configuration: DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
};

function getRiskClasses(risk: string) {
  if (risk === "High") {
    return "border-red-500/30 bg-red-500/[0.08] text-red-200";
  }

  if (risk === "Medium") {
    return "border-amber-500/30 bg-amber-500/[0.08] text-amber-200";
  }

  return "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200";
}

function getTrendIcon(trend: string) {
  if (trend === "Improving") {
    return <TrendingUp size={14} className="text-emerald-400" />;
  }

  if (trend === "Action Needed" || trend === "Declining") {
    return <TrendingDown size={14} className="text-red-300" />;
  }

  return <LineChart size={14} className="text-blue-300" />;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Target;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          {label}
        </p>
        <Icon size={17} className="text-blue-400" />
      </div>

      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const { departmentId, hasPermission } = useTracePointAccess();
  const canConfigure = hasPermission("administer_department");
  const [summary, setSummary] =
    useState<PerformanceSummary>(FALLBACK_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addSectionsOpen, setAddSectionsOpen] = useState(false);
  const editor = useVisualConfigurationEditor({
    configuration: summary.configuration,
    departmentId,
    canAdminister: canConfigure,
    editorName: "analytics",
    onSaved: (configuration) =>
      setSummary((current) => ({ ...current, configuration })),
  });
  const displayConfiguration = editor.editing
    ? editor.draft
    : summary.configuration;

  useEffect(() => {
    let isMounted = true;

    async function loadSummary() {
      try {
        const response = await fetch("/api/pilot/performance-summary", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load performance data.");
        }

        const payload = (await response.json()) as PerformanceSummary;

        if (!isMounted) return;

        setSummary({
          ...FALLBACK_SUMMARY,
          ...payload,
          metrics: {
            ...FALLBACK_SUMMARY.metrics,
            ...(payload.metrics ?? {}),
          },
          qualificationTrends: payload.qualificationTrends ?? [],
          drillTrends: payload.drillTrends ?? [],
          broadCategoryTrends: payload.broadCategoryTrends ?? [],
          configuration: normalizeAnalyticsDashboardConfiguration(
            payload.configuration,
          ),
        });
      } catch (error) {
        if (!isMounted) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load performance data.",
        );
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadSummary();

    return () => {
      isMounted = false;
    };
  }, []);

  const overviewMetrics = useMemo(
    () => [
      {
        id: "qualification_coverage" as AnalyticsMetricKey,
        label: "Qualification Coverage",
        value: summary.metrics.qualificationCoverage,
        detail: "Officers with current day and night records",
        icon: Target,
      },
      {
        id: "drill_performance" as AnalyticsMetricKey,
        label: "Drill Performance",
        value: summary.metrics.drillPerformance,
        detail: "Average change across comparable drill histories",
        icon: TrendingUp,
      },
      {
        id: "training_follow_ups" as AnalyticsMetricKey,
        label: "Training Follow-Ups",
        value: summary.metrics.trainingFollowUps,
        detail: "Generated drill-performance concerns",
        icon: AlertTriangle,
      },
      {
        id: "officer_watchlist" as AnalyticsMetricKey,
        label: "Personnel Requiring Review",
        value: summary.metrics.officerWatchlist,
        detail: "Officers with qualification or drill-performance risk",
        icon: ShieldAlert,
      },
    ],
    [summary.metrics],
  );

  const visibleOverviewMetrics = overviewMetrics.filter(
    (metric) => displayConfiguration.analytics_metrics[metric.id],
  );
  const alertLogicItems = [
    {
      title: "Qualification readiness exceptions",
      detail:
        "Failed, expired, due-soon, or missing required qualification records generate a signal using the agency's qualification requirements and renewal warning window.",
    },
    {
      title: "Repeated drill deficiency",
      detail: `A historical drill pattern becomes high priority after ${displayConfiguration.repeated_deficiency_count} range-day record${displayConfiguration.repeated_deficiency_count === 1 ? "" : "s"} with a failure, observed deficiency, or remediation recommendation. A latest failed or remediation-recommended result is already high priority.`,
    },
    {
      title: "Performance movement",
      detail: `A comparable result is labeled improving or declining only when movement exceeds ${displayConfiguration.trend_change_threshold} point${displayConfiguration.trend_change_threshold === 1 ? "" : "s"}; smaller changes remain stable.`,
    },
  ];

  function patchDraft(
    patch: Partial<AnalyticsDashboardConfiguration>,
  ) {
    editor.setDraft((current) => ({ ...current, ...patch }));
  }

  const orderedVisibleSections = displayConfiguration.analytics_section_order.filter(
    (key) => displayConfiguration.analytics_sections[key],
  );

  function moveAnalyticsSection(key: AnalyticsSectionKey, direction: -1 | 1) {
    const visibleIndex = orderedVisibleSections.indexOf(key);
    const neighbor = orderedVisibleSections[visibleIndex + direction];
    if (!neighbor) return;

    const keyIndex = editor.draft.analytics_section_order.indexOf(key);
    const neighborIndex = editor.draft.analytics_section_order.indexOf(neighbor);
    const next = [...editor.draft.analytics_section_order];
    [next[keyIndex], next[neighborIndex]] = [next[neighborIndex], next[keyIndex]];
    patchDraft({ analytics_section_order: next });
  }

  const advancedSettings: Array<{
    key: keyof Pick<
      AnalyticsDashboardConfiguration,
      | "trend_change_threshold"
      | "repeated_deficiency_count"
      | "command_attention_item_limit"
      | "command_training_attention_window_days"
      | "command_training_upcoming_window_days"
      | "command_fleet_attention_window_days"
      | "command_training_upcoming_item_limit"
      | "command_training_attention_item_limit"
      | "command_fleet_attention_item_limit"
      | "command_operations_attention_item_limit"
      | "upcoming_range_days_item_limit"
    >;
    label: string;
    min: number;
    max: number;
  }> = [
    { key: "trend_change_threshold", label: "Meaningful trend change", min: 0, max: 100 },
    { key: "repeated_deficiency_count", label: "Repeated deficiency", min: 1, max: 20 },
    { key: "command_attention_item_limit", label: "Command attention limit", min: 1, max: 25 },
    { key: "command_training_attention_window_days", label: "Training attention window", min: 1, max: 90 },
    { key: "command_training_upcoming_window_days", label: "Upcoming training window", min: 1, max: 365 },
    { key: "command_fleet_attention_window_days", label: "Fleet attention window", min: 1, max: 365 },
    { key: "command_training_upcoming_item_limit", label: "Upcoming training limit", min: 1, max: 25 },
    { key: "command_training_attention_item_limit", label: "Training attention limit", min: 1, max: 25 },
    { key: "command_fleet_attention_item_limit", label: "Fleet attention limit", min: 1, max: 25 },
    { key: "command_operations_attention_item_limit", label: "Combined operations limit", min: 1, max: 25 },
    { key: "upcoming_range_days_item_limit", label: "Upcoming range-day limit", min: 1, max: 20 },
  ];

  return (
    <TracePointShell activePage="Analytics">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Command Analytics
              </p>
              <h1 className="mt-1 text-[24px] font-bold text-white">
                Qualification & Drill Performance Trends
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] leading-6 text-slate-500">
                Review qualification compliance, drill performance, training
                follow-ups, and officers requiring attention.
              </p>
            </div>
            {canConfigure && !editor.editing ? (
              <button
                type="button"
                onClick={editor.begin}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <SlidersHorizontal size={14} />
                Customize Analytics
              </button>
            ) : null}
          </div>
        </header>

        {editor.editing ? (
          <CustomizationBar
            title="Compose your Analytics view"
            description="Choose the signals your command staff needs and arrange detailed sections in the order they should be reviewed."
            addLabel="Add Metric / Section"
            addOpen={addSectionsOpen}
            dirty={editor.dirty}
            saving={editor.saving}
            notice={editor.notice}
            onToggleAdd={() => setAddSectionsOpen((open) => !open)}
            onReset={editor.reset}
            onCancel={editor.cancel}
            onSave={() => void editor.save()}
          >
            <div className="grid gap-5 xl:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Summary metrics
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(Object.keys(ANALYTICS_METRIC_DETAILS) as AnalyticsMetricKey[]).map((key) => {
                    const visible = editor.draft.analytics_metrics[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        onClick={() =>
                          patchDraft({
                            analytics_metrics: {
                              ...editor.draft.analytics_metrics,
                              [key]: !visible,
                            },
                          })
                        }
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${
                          visible
                            ? "border-blue-500/35 bg-blue-500/10 text-blue-100"
                            : "border-slate-800 bg-slate-950/50 text-slate-500"
                        }`}
                      >
                        {ANALYTICS_METRIC_DETAILS[key]}
                        <span className="text-[9px]">{visible ? "Shown" : "Add"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Analytics sections
                </p>
                <div className="mt-3 space-y-2">
                  {editor.draft.analytics_section_order.map((key) => {
                    const visible = editor.draft.analytics_sections[key];
                    const visibleIndex = orderedVisibleSections.indexOf(key);
                    return (
                      <div
                        key={key}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                          visible
                            ? "border-blue-500/30 bg-blue-500/[0.08]"
                            : "border-slate-800 bg-slate-950/50"
                        }`}
                      >
                        <span className={`text-xs font-semibold ${visible ? "text-slate-200" : "text-slate-500"}`}>
                          {ANALYTICS_SECTION_DETAILS[key]}
                        </span>
                        <span className="flex items-center gap-2">
                          {visible ? (
                            <ReorderButtons
                              label={ANALYTICS_SECTION_DETAILS[key]}
                              first={visibleIndex === 0}
                              last={visibleIndex === orderedVisibleSections.length - 1}
                              onPrevious={() => moveAnalyticsSection(key, -1)}
                              onNext={() => moveAnalyticsSection(key, 1)}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              patchDraft({
                                analytics_sections: {
                                  ...editor.draft.analytics_sections,
                                  [key]: !visible,
                                },
                              })
                            }
                            className="rounded-lg border border-slate-700 px-2 py-1.5 text-[9px] font-semibold text-slate-400 hover:text-white"
                          >
                            {visible ? "Remove" : "Add"}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <AdvancedSettings>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {advancedSettings.map((setting) => (
                    <label key={setting.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <span className="block text-xs font-semibold text-slate-300">{setting.label}</span>
                      <input
                        type="number"
                        min={setting.min}
                        max={setting.max}
                        value={editor.draft[setting.key]}
                        onChange={(event) =>
                          patchDraft({
                            [setting.key]: Math.max(
                              setting.min,
                              Math.min(setting.max, Number(event.target.value)),
                            ),
                          })
                        }
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                      />
                    </label>
                  ))}
                </div>
              </AdvancedSettings>
            </div>
          </CustomizationBar>
        ) : null}

        {(loadError || (!loading && !summary.hasWorkspaceData)) && (
          <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
            {loadError ??
              "No saved Range & Training data was found yet. Create and save a range day, roster, drill, or score first."}
          </section>
        )}

        {visibleOverviewMetrics.length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visibleOverviewMetrics.map((metric) => (
              <MetricCard key={metric.id} {...metric} />
            ))}
          </section>
        ) : null}

        <div className="flex flex-col gap-5">
        {displayConfiguration.analytics_sections.qualification_trends ? (
        <section
          style={{ order: displayConfiguration.analytics_section_order.indexOf("qualification_trends") }}
          className={`rounded-3xl border bg-slate-900 p-4 sm:p-5 ${editor.editing ? "border-blue-500/40 ring-1 ring-blue-500/10" : "border-slate-800"}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
                <Target size={18} className="text-blue-400" />
                Qualification Trends
              </h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                Formal qualification compliance is calculated from saved
                qualification-style drill results, including day/night coverage,
                score movement, and compliance risk.
              </p>
            </div>

            <span className="w-fit rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
              Compliance view
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
            <div className="hidden grid-cols-[1.25fr_0.8fr_0.65fr_0.65fr_0.8fr_0.85fr_0.65fr] gap-3 border-b border-slate-800 bg-slate-950/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600 xl:grid">
              <div>Officer</div>
              <div>Status</div>
              <div>Day</div>
              <div>Night</div>
              <div>Trend</div>
              <div>Coverage / Last Qual</div>
              <div>Risk</div>
            </div>

            <div className="divide-y divide-slate-800">
              {summary.qualificationTrends.length === 0 ? (
                <div className="px-4 py-5 text-[12px] text-slate-500">
                  No qualification trend rows are available. Add active
                  personnel and save qualification results to populate this view.
                </div>
              ) : (
                summary.qualificationTrends.map((officer) => (
                  <div
                    key={officer.officerId}
                    className="grid gap-3 px-4 py-4 xl:grid-cols-[1.25fr_0.8fr_0.65fr_0.65fr_0.8fr_0.85fr_0.65fr] xl:items-center"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-white">
                        {officer.name}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {officer.assignment}
                      </p>
                      <p className="mt-2 text-[11px] leading-5 text-slate-400 xl:hidden">
                        {officer.detail}
                      </p>
                    </div>

                    <div className="text-[12px] font-semibold text-slate-300">
                      {officer.status}
                    </div>

                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                      <Sun size={13} className="text-amber-300" />
                      {officer.dayScore}
                    </div>

                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                      <Moon size={13} className="text-blue-300" />
                      {officer.nightScore}
                    </div>

                    <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
                      {getTrendIcon(officer.trend)}
                      {officer.trend}
                    </div>

                    <div>
                      <p className="text-[12px] font-semibold text-slate-300">
                        {officer.dayNightGap}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {officer.lastQualified}
                      </p>
                    </div>

                    <div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getRiskClasses(
                          officer.risk,
                        )}`}
                      >
                        {officer.risk}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        ) : null}

        {displayConfiguration.analytics_sections.drill_trends ? (
        <section
          style={{ order: displayConfiguration.analytics_section_order.indexOf("drill_trends") }}
          className={`rounded-3xl border bg-slate-900 p-4 sm:p-5 ${editor.editing ? "border-blue-500/40 ring-1 ring-blue-500/10" : "border-slate-800"}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
                <Users size={18} className="text-blue-400" />
                Drill Performance Trends
              </h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                Practical drill trends identify skill performance over time and
                can flag declining performance even when an officer remains
                qualification-current.
              </p>
            </div>

            <span className="w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
              Skill-performance view
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
            <div className="hidden grid-cols-[1.25fr_0.95fr_0.75fr_0.75fr_1.1fr_0.8fr_0.65fr] gap-3 border-b border-slate-800 bg-slate-950/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600 xl:grid">
              <div>Officer</div>
              <div>Category</div>
              <div>Trend</div>
              <div>Change</div>
              <div>Weak Area</div>
              <div>Remedial</div>
              <div>Risk</div>
            </div>

            <div className="divide-y divide-slate-800">
              {summary.drillTrends.length === 0 ? (
                <div className="px-4 py-5 text-[12px] text-slate-500">
                  No drill-performance history is available. Save results for
                  the same drill on multiple range days to establish a trend.
                </div>
              ) : (
                summary.drillTrends.map((officer) => (
                  <div
                    key={`${officer.officerId}-${officer.category}-${officer.drillName}`}
                    className="grid gap-3 px-4 py-4 xl:grid-cols-[1.25fr_0.95fr_0.75fr_0.75fr_1.1fr_0.8fr_0.65fr] xl:items-center"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-white">
                        {officer.name}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {officer.assignment}
                      </p>
                      <p className="mt-2 text-[11px] leading-5 text-slate-400 xl:hidden">
                        {officer.detail}
                      </p>
                    </div>

                    <div>
                                            <p className="text-[12px] font-semibold text-slate-300">
                        {officer.drillName}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {officer.category} / Repeated deficiency: {officer.repeatedDeficiency}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
                      {getTrendIcon(officer.trend)}
                      {officer.trend}
                    </div>

                    <div className="text-[12px] font-semibold text-slate-300">
                      {officer.averageChange}
                    </div>

                    <div>
                      <p className="text-[12px] font-semibold text-slate-300">
                        {officer.weakArea}
                      </p>
                      <p className="mt-1 hidden text-[10px] leading-4 text-slate-500 xl:block">
                        {officer.detail}
                      </p>
                    </div>

                    <div className="text-[12px] font-semibold text-slate-300">
                      {officer.remedial}
                    </div>

                    <div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getRiskClasses(
                          officer.risk,
                        )}`}
                      >
                        {officer.risk}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        ) : null}

        {displayConfiguration.analytics_sections.category_trends ||
        displayConfiguration.analytics_sections.alert_logic_guide ? (
        <section className="contents">
          {displayConfiguration.analytics_sections.category_trends ? (
          <div
            style={{ order: displayConfiguration.analytics_section_order.indexOf("category_trends") }}
            className={`rounded-3xl border bg-slate-900 p-4 sm:p-5 ${editor.editing ? "border-blue-500/40 ring-1 ring-blue-500/10" : "border-slate-800"}`}
          >
            <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
              <BarChart3 size={18} className="text-blue-400" />
              Broad Drill Category Trends
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Department-wide patterns by drill type help range staff select
              future training blocks and identify systemic training gaps.
            </p>

            <div className="mt-4 space-y-2">
              {summary.broadCategoryTrends.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[12px] text-slate-500">
                  No category trend is available yet. Save comparable drill
                  results on at least two range days to establish direction.
                </div>
              ) : (
                summary.broadCategoryTrends.map((trend) => (
                  <div
                    key={trend.category}
                    className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {trend.category}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Affected: {trend.affected}
                        </p>
                      </div>

                      <span className="inline-flex w-fit items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
                        {getTrendIcon(trend.direction)}
                        {trend.direction}
                      </span>
                    </div>

                    <p className="mt-3 text-[11px] leading-5 text-slate-400">
                      {trend.detail}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
          ) : null}

          {displayConfiguration.analytics_sections.alert_logic_guide ? (
          <div
            style={{ order: displayConfiguration.analytics_section_order.indexOf("alert_logic_guide") }}
            className={`rounded-3xl border bg-slate-900 p-4 sm:p-5 ${editor.editing ? "border-blue-500/40 ring-1 ring-blue-500/10" : "border-slate-800"}`}
          >
            <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
              <ShieldAlert size={18} className="text-amber-300" />
              How Analytics Signals Are Interpreted
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              This is an explanation of the configured signal logic, not a
              separate list of personnel or an operational standard.
            </p>

            <div className="mt-4 space-y-2">
              {alertLogicItems.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3"
                >
                  <p className="text-[13px] font-semibold text-white">
                    {item.title}
                  </p>

                  <p className="mt-2 text-[11px] leading-5 text-slate-400">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-emerald-200">
                <CheckCircle2 size={15} />
                Agency configuration is active.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Qualification and drill results feed the visible metrics and
                sections using the thresholds shown above.
              </p>
            </div>
          </div>
          ) : null}
        </section>
        ) : null}

        {displayConfiguration.analytics_sections.performance_inputs ? (
        <section
          style={{ order: displayConfiguration.analytics_section_order.indexOf("performance_inputs") }}
          className={`rounded-3xl border bg-slate-900/60 p-4 sm:p-5 ${editor.editing ? "border-blue-500/40 ring-1 ring-blue-500/10" : "border-slate-800"}`}
        >
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
            <UserCheck size={18} className="text-blue-400" />
            Analytics Data Inputs
          </h2>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              "Qualification Results",
              "Range-Day Drill Results",
              "Training Notes",
              "Remedial Training",
            ].map((label) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"
              >
                <p className="text-[12px] font-semibold text-slate-200">
                  {label}
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  Used only when the record is present and relevant to the
                  configured analytics sections.
                </p>
              </div>
            ))}
          </div>
        </section>
        ) : null}
        </div>
      </div>
    </TracePointShell>
  );
}

