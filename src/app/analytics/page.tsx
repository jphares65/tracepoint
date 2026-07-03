"use client";

import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  LineChart,
  Moon,
  ShieldAlert,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";

type Risk = "Low" | "Medium" | "High";
type Trend = "Improving" | "Stable" | "Monitor" | "Declining" | "Action Needed";

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
};

const WATCHLIST = [
  {
    title: "Qualification compliance gap",
    detail:
      "Separate day and night qualification status should drive compliance alerts and command visibility.",
    severity: "High",
  },
  {
    title: "Repeated drill deficiency",
    detail:
      "Drill trends should generate remedial follow-up when deficiencies repeat across multiple range days.",
    severity: "Medium",
  },
  {
    title: "Qualification vs drill mismatch",
    detail:
      "An officer may be qualification-current but still show declining practical drill performance.",
    severity: "Medium",
  },
];

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
  const [summary, setSummary] =
    useState<PerformanceSummary>(FALLBACK_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSummary() {
      try {
        const response = await fetch("/api/pilot/performance-summary", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load saved pilot performance data.");
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
        label: "Qualification Coverage",
        value: summary.metrics.qualificationCoverage,
        detail: "Officers with current day and night records",
        icon: Target,
      },
      {
        label: "Drill Performance",
        value: summary.metrics.drillPerformance,
        detail: "Average score movement across saved drill results",
        icon: TrendingUp,
      },
      {
        label: "Training Follow-Ups",
        value: summary.metrics.trainingFollowUps,
        detail: "Generated drill-performance concerns",
        icon: AlertTriangle,
      },
      {
        label: "Officer Watchlist",
        value: summary.metrics.officerWatchlist,
        detail: "Officers with qualification or drill-performance risk",
        icon: ShieldAlert,
      },
    ],
    [summary.metrics],
  );

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
                Live pilot analytics now read from the saved Range & Training
                workspace in Supabase, separating formal qualification compliance
                from practical drill-performance trends.
              </p>
            </div>

            <span className="w-fit rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
              Supabase pilot data
            </span>
          </div>
        </header>

        {(loadError || (!loading && !summary.hasWorkspaceData)) && (
          <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
            {loadError ??
              "No saved Range & Training data was found yet. Create and save a range day, roster, drill, or score first."}
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewMetrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
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
              <div>Gap / Last Qual</div>
              <div>Risk</div>
            </div>

            <div className="divide-y divide-slate-800">
              {summary.qualificationTrends.length === 0 ? (
                <div className="px-4 py-5 text-[12px] text-slate-500">
                  No qualification trends are available yet.
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

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
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
                  No drill-performance trends are available yet.
                </div>
              ) : (
                summary.drillTrends.map((officer) => (
                  <div
                    key={`${officer.officerId}-${officer.category}`}
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
                        {officer.category}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Repeated deficiency: {officer.repeatedDeficiency}
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

        <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
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
                  Broad drill category trends will populate after drill results
                  are saved.
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

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
              <ShieldAlert size={18} className="text-amber-300" />
              Training Watchlist
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Issues that should generate command visibility or range-staff
              follow-up once analytics are connected to live data.
            </p>

            <div className="mt-4 space-y-2">
              {WATCHLIST.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-semibold text-white">
                      {item.title}
                    </p>
                    <span className={getRiskClasses(item.severity)}>
                      <span className="rounded-full border border-current/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                        {item.severity}
                      </span>
                    </span>
                  </div>

                  <p className="mt-2 text-[11px] leading-5 text-slate-400">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
              <p className="flex items-center gap-2 text-[12px] font-semibold text-emerald-200">
                <CheckCircle2 size={15} />
                Officer performance analytics now use saved pilot data.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Qualification and drill trends are calculated from the
                Supabase-backed Range & Training workspace.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
            <UserCheck size={18} className="text-blue-400" />
            Live Officer Performance Inputs
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
                  Feeds officer trends, alerts, watchlists, and command-level
                  training risk indicators.
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
