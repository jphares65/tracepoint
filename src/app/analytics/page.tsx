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

const OVERVIEW_METRICS = [
  {
    label: "Qualification Coverage",
    value: "94%",
    detail: "Officers with current day and night records",
    icon: Target,
  },
  {
    label: "Drill Performance",
    value: "+4.8%",
    detail: "Average improvement across recent drills",
    icon: TrendingUp,
  },
  {
    label: "Training Follow-Ups",
    value: "3",
    detail: "Open remedial or deficient records",
    icon: AlertTriangle,
  },
  {
    label: "Officer Watchlist",
    value: "3",
    detail: "Officers with qualification or drill-performance risk",
    icon: ShieldAlert,
  },
];

const QUALIFICATION_TRENDS = [
  {
    name: "Officer A. Matthews",
    assignment: "Patrol Squad 1",
    status: "Current",
    dayScore: "94%",
    nightScore: "91%",
    trend: "Improving",
    dayNightGap: "Low",
    lastQualified: "May 2026",
    risk: "Low",
    detail:
      "Current in both day and night qualifications with scores trending upward.",
  },
  {
    name: "Officer B. Carter",
    assignment: "Patrol Squad 2",
    status: "Current",
    dayScore: "88%",
    nightScore: "79%",
    trend: "Monitor",
    dayNightGap: "Moderate",
    lastQualified: "May 2026",
    risk: "Medium",
    detail:
      "Day qualification remains stable, but night-fire performance is lagging.",
  },
  {
    name: "Officer C. Reynolds",
    assignment: "Patrol Squad 3",
    status: "Night Missing",
    dayScore: "84%",
    nightScore: "Missing",
    trend: "Action Needed",
    dayNightGap: "High",
    lastQualified: "Day only",
    risk: "High",
    detail:
      "Night qualification coverage is missing and should be scheduled for the next low-light block.",
  },
  {
    name: "Officer D. Walsh",
    assignment: "Investigations",
    status: "Current",
    dayScore: "92%",
    nightScore: "90%",
    trend: "Stable",
    dayNightGap: "Low",
    lastQualified: "April 2026",
    risk: "Low",
    detail:
      "Consistent qualification performance with no compliance issue detected.",
  },
];

const DRILL_TRENDS = [
  {
    name: "Officer A. Matthews",
    assignment: "Patrol Squad 1",
    category: "Timed Marksmanship",
    trend: "Improving",
    averageChange: "+7.2%",
    weakArea: "Timed transition drills",
    repeatedDeficiency: "No",
    remedial: "None",
    risk: "Low",
    detail:
      "Drill scores improved across the last three range events with faster completion times.",
  },
  {
    name: "Officer B. Carter",
    assignment: "Patrol Squad 2",
    category: "Low-Light Drills",
    trend: "Declining",
    averageChange: "-2.8%",
    weakArea: "Low-light accuracy",
    repeatedDeficiency: "Yes",
    remedial: "Recommended",
    risk: "Medium",
    detail:
      "Accuracy drops when light conditions change despite otherwise stable qualification coverage.",
  },
  {
    name: "Officer C. Reynolds",
    assignment: "Patrol Squad 3",
    category: "Decision-Making",
    trend: "Action Needed",
    averageChange: "-6.4%",
    weakArea: "Scenario decision-making",
    repeatedDeficiency: "Yes",
    remedial: "Open",
    risk: "High",
    detail:
      "Repeated deficiencies were observed in judgment, command sequence, and scenario-based drills.",
  },
  {
    name: "Officer D. Walsh",
    assignment: "Investigations",
    category: "Administrative Handling",
    trend: "Stable",
    averageChange: "+0.6%",
    weakArea: "No repeated deficiency",
    repeatedDeficiency: "No",
    remedial: "None",
    risk: "Low",
    detail:
      "Steady drill results with no repeated deficiency or remedial trend detected.",
  },
];

const DRILL_CATEGORY_TRENDS = [
  {
    category: "Low-Light Performance",
    direction: "Declining",
    affected: "4 officers",
    detail:
      "Night-fire and low-light drill results show the largest performance gap across the current training cycle.",
  },
  {
    category: "Timed Marksmanship",
    direction: "Improving",
    affected: "Department-wide",
    detail:
      "Recent range days show faster completion times without an increase in failed runs.",
  },
  {
    category: "Decision-Making Drills",
    direction: "Monitor",
    affected: "2 officers",
    detail:
      "Scenario notes show repeated hesitation and command-sequence deficiencies.",
  },
  {
    category: "Reload & Clearance Drills",
    direction: "Stable",
    affected: "Department-wide",
    detail:
      "No current department-wide concern, but individual repeated deficiencies should still be captured for remedial follow-up.",
  },
];

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

export default function AnalyticsPage() {
  return (
    <TracePointShell activePage="Analytics">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
            Command Analytics
          </p>
          <h1 className="mt-1 text-[24px] font-bold text-white">
            Qualification & Drill Performance Trends
          </h1>
          <p className="mt-1 max-w-4xl text-[12px] leading-6 text-slate-500">
            Separate formal qualification compliance from practical drill
            performance so command staff can see who is qualified, who is
            improving, who is declining, and where training risk is emerging.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {OVERVIEW_METRICS.map((metric) => {
            const Icon = metric.icon;

            return (
              <div
                key={metric.label}
                className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    {metric.label}
                  </p>
                  <Icon size={17} className="text-blue-400" />
                </div>

                <p className="mt-3 text-3xl font-bold text-white">
                  {metric.value}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {metric.detail}
                </p>
              </div>
            );
          })}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
                <Target size={18} className="text-blue-400" />
                Qualification Trends
              </h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-slate-500">
                Formal qualification compliance should be tracked separately
                from drill performance. This section focuses on day/night
                coverage, current status, score movement, and compliance risk.
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
              {QUALIFICATION_TRENDS.map((officer) => (
                <div
                  key={officer.name}
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
              ))}
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
                Practical drill trends identify skill performance over time.
                This is where TracePoint can flag declining drill performance
                even when the officer remains qualification-current.
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
              {DRILL_TRENDS.map((officer) => (
                <div
                  key={`${officer.name}-${officer.category}`}
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
              ))}
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
              {DRILL_CATEGORY_TRENDS.map((trend) => (
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
              ))}
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
                Officer performance analytics only.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                This page intentionally focuses on qualifications, drills,
                deficiencies, remediation, and training risk. Inventory and
                equipment readiness analytics should live in Armory or the
                Command Dashboard.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
            <UserCheck size={18} className="text-blue-400" />
            Planned Live Officer Performance Inputs
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
                  Will feed officer trends, alerts, watchlists, and
                  command-level training risk indicators.
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
