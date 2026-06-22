"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TracePointShell from "@/app/components/TracePointShell";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FileText,
  Moon,
  Shield,
  ShieldAlert,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";

import type { FirearmMalfunction } from "@/app/lib/tracepoint/types";

import type {
  DrillRunResult,
  DrillTemplate,
  RangeDay,
  RangeDayDrill,
  RangeRosterEntry,
} from "@/app/lib/tracepoint/range-day-types";

import {
  DEMO_DEPARTMENT,
  MOCK_FIREARMS,
  MOCK_USERS,
} from "@/app/lib/tracepoint/mock-data";

type StoredRangeDay = RangeDay & {
  rangeType?: string;
  startTime?: string;
  endTime?: string;
  packetStatus?: string;
  staffingNotes?: string;
  outline?: string[];
};

type StoredRangeDayWorkspace = {
  rangeDays: StoredRangeDay[];
  drillLibrary: DrillTemplate[];
  rangeDayDrills: RangeDayDrill[];
  rangeRoster: RangeRosterEntry[];
  results: DrillRunResult[];
  malfunctions: FirearmMalfunction[];
};

type ReadinessStatus =
  | "Current"
  | "Needs Day"
  | "Needs Night"
  | "Failed"
  | "Overdue"
  | "No Record";

type Priority = "Critical" | "High" | "Medium" | "Low";
type Tone = "blue" | "green" | "amber" | "red" | "slate";

type OfficerSummary = {
  officerId: string;
  officerName: string;
  status: ReadinessStatus;
  statusReason: string;
  lastDayQualification?: DrillRunResult;
  lastNightQualification?: DrillRunResult;
  lastQualificationDate?: string;
  failedQualificationCount: number;
  scoreTrend: "Improving" | "Declining" | "Stable" | "Insufficient Data";
  trendDelta?: number;
};

type DrillAnalyticsSummary = {
  drillId: string;
  drillName: string;
  resultCount: number;
  passRate: number;
  averageScore?: number;
  failedCount: number;
};

type CriticalItem = {
  id: string;
  title: string;
  detail: string;
  module: "Qualifications" | "Range" | "Firearms" | "Analytics" | "Records";
  href: string;
  priority: Priority;
  icon: typeof Shield;
};

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";
const QUALIFICATION_VALID_DAYS = 365;

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

function loadStoredRangeDayWorkspace(): StoredRangeDayWorkspace | null {
  if (typeof window === "undefined") return null;

  try {
    const storedWorkspace = window.localStorage.getItem(
      RANGE_DAY_WORKSPACE_STORAGE_KEY,
    );

    if (!storedWorkspace) return null;

    const parsed = JSON.parse(
      storedWorkspace,
    ) as Partial<StoredRangeDayWorkspace>;

    return {
      rangeDays: Array.isArray(parsed.rangeDays) ? parsed.rangeDays : [],
      drillLibrary: Array.isArray(parsed.drillLibrary) ? parsed.drillLibrary : [],
      rangeDayDrills: Array.isArray(parsed.rangeDayDrills)
        ? parsed.rangeDayDrills
        : [],
      rangeRoster: Array.isArray(parsed.rangeRoster) ? parsed.rangeRoster : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      malfunctions: Array.isArray(parsed.malfunctions)
        ? parsed.malfunctions
        : [],
    };
  } catch (error) {
    console.warn("Could not load saved range day workspace.", error);
    return null;
  }
}

function getRecordValue(item: unknown, keys: string[]) {
  const record = item as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
  }

  return undefined;
}

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = date.includes("T")
    ? new Date(date).getTime()
    : new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function getTodayValue() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getDaysSince(date?: string) {
  const value = getDateValue(date);

  if (!value) return undefined;

  return Math.max(
    Math.floor((getTodayValue() - value) / (1000 * 60 * 60 * 24)),
    0,
  );
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmStatusLabel(firearm: (typeof MOCK_FIREARMS)[number]) {
  return (
    getRecordValue(firearm, [
      "status",
      "condition",
      "inventoryStatus",
      "serviceStatus",
      "operationalStatus",
    ]) ?? "Active"
  );
}

function getFirearmTypeLabel(firearm: (typeof MOCK_FIREARMS)[number]) {
  return (
    getRecordValue(firearm, [
      "type",
      "firearmType",
      "category",
      "weaponType",
      "classification",
    ]) ?? "Firearm"
  );
}

function isQualificationDrill(drill?: RangeDayDrill | null) {
  if (!drill) return false;

  return (
    drill.category === "Qualification" ||
    drill.name.toLowerCase().includes("qualification")
  );
}

function isPassed(result: DrillRunResult) {
  if (typeof result.passed === "boolean") return result.passed;

  return result.completed;
}

function getResultDate(
  result: DrillRunResult | undefined,
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  if (!result) return undefined;

  return rangeDaysById.get(result.rangeDayId)?.date;
}

function sortResultsNewestFirst(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  return [...results].sort(
    (a, b) =>
      getDateValue(getResultDate(b, rangeDaysById)) -
      getDateValue(getResultDate(a, rangeDaysById)),
  );
}

function sortResultsOldestFirst(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  return [...results].sort(
    (a, b) =>
      getDateValue(getResultDate(a, rangeDaysById)) -
      getDateValue(getResultDate(b, rangeDaysById)),
  );
}

function getScoreTrend(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
): OfficerSummary["scoreTrend"] {
  const scoredResults = sortResultsOldestFirst(
    results.filter((result) => typeof result.score === "number"),
    rangeDaysById,
  );

  if (scoredResults.length < 3) return "Insufficient Data";

  const firstScore = scoredResults[0].score ?? 0;
  const lastScore = scoredResults[scoredResults.length - 1].score ?? 0;
  const delta = lastScore - firstScore;

  if (delta <= -5) return "Declining";
  if (delta >= 5) return "Improving";

  return "Stable";
}

function getTrendDelta(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  const scoredResults = sortResultsOldestFirst(
    results.filter((result) => typeof result.score === "number"),
    rangeDaysById,
  );

  if (scoredResults.length < 3) return undefined;

  const firstScore = scoredResults[0].score ?? 0;
  const lastScore = scoredResults[scoredResults.length - 1].score ?? 0;

  return lastScore - firstScore;
}

function getPriorityValue(priority: Priority) {
  const order: Record<Priority, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  };

  return order[priority];
}

function getPriorityTone(priority: Priority): Tone {
  if (priority === "Critical" || priority === "High") return "red";
  if (priority === "Medium") return "amber";

  return "blue";
}

function getToneClasses(tone: Tone) {
  const styles = {
    blue: "border-blue-500/25 bg-blue-500/[0.08] text-blue-300",
    green: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
    red: "border-red-500/25 bg-red-500/[0.08] text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return styles[tone];
}

function StatusPill({ label, tone = "blue" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getToneClasses(tone)}`}
    >
      {label}
    </span>
  );
}

function PulseCard({
  title,
  value,
  label,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  label: string;
  detail: string;
  icon: typeof Shield;
  tone: Tone;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {title}
          </p>
          <p className="mt-1 text-3xl font-bold text-white">{value}</p>
          <p className="mt-1 text-[12px] font-semibold text-slate-300">
            {label}
          </p>
        </div>

        <div className={`rounded-2xl border p-2.5 ${getToneClasses(tone)}`}>
          <Icon size={18} />
        </div>
      </div>

      <p className="mt-3 border-t border-slate-800 pt-3 text-[11px] leading-5 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center text-[12px] text-slate-500">
      {message}
    </div>
  );
}

function CriticalItemRow({ item }: { item: CriticalItem }) {
  const Icon = item.icon;
  const tone = getPriorityTone(item.priority);

  return (
    <Link
      href={item.href}
      className={`group flex items-start justify-between gap-3 rounded-2xl border p-3 transition hover:border-blue-500/40 ${getToneClasses(tone)}`}
    >
      <div className="flex min-w-0 gap-3">
        <div className={`h-fit rounded-xl border p-2 ${getToneClasses(tone)}`}>
          <Icon size={15} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={item.priority} tone={tone} />
            <StatusPill label={item.module} tone="slate" />
          </div>

          <p className="mt-2 text-[13px] font-bold text-white">{item.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            {item.detail}
          </p>
        </div>
      </div>

      <ChevronRight
        size={15}
        className="mt-1 shrink-0 text-slate-600 group-hover:text-blue-300"
      />
    </Link>
  );
}

function SnapshotLink({
  title,
  href,
  icon: Icon,
  primary,
  secondary,
  tone,
}: {
  title: string;
  href: string;
  icon: typeof Shield;
  primary: string;
  secondary: string;
  tone: Tone;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-white">{title}</p>
          <p className="mt-1 text-[11px] text-slate-400">{primary}</p>
          <p className="mt-1 text-[11px] text-slate-600">{secondary}</p>
        </div>

        <div className={`rounded-xl border p-2 ${getToneClasses(tone)}`}>
          <Icon size={15} />
        </div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  useEffect(() => {
    setWorkspace(loadStoredRangeDayWorkspace() ?? EMPTY_WORKSPACE);
    setWorkspaceLoaded(true);
  }, []);

  const rangeDaysById = useMemo(() => {
    return new Map(
      workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
    );
  }, [workspace.rangeDays]);

  const drillsById = useMemo(() => {
    return new Map(workspace.rangeDayDrills.map((drill) => [drill.id, drill]));
  }, [workspace.rangeDayDrills]);

  const activeRangeDays = useMemo(
    () =>
      workspace.rangeDays.filter(
        (rangeDay) => rangeDay.status !== "Archived",
      ),
    [workspace.rangeDays],
  );

  const upcomingRangeDays = useMemo(() => {
    return activeRangeDays
      .filter((rangeDay) => getDateValue(rangeDay.date) >= getTodayValue())
      .sort((a, b) => getDateValue(a.date) - getDateValue(b.date))
      .slice(0, 4);
  }, [activeRangeDays]);

  const incompletePackets = useMemo(() => {
    return activeRangeDays.filter(
      (rangeDay) =>
        rangeDay.status !== "Completed" &&
        rangeDay.status !== "Locked" &&
        rangeDay.packetStatus !== "Ready",
    );
  }, [activeRangeDays]);

  const qualificationResults = useMemo(() => {
    return workspace.results.filter((result) =>
      isQualificationDrill(drillsById.get(result.drillId)),
    );
  }, [workspace.results, drillsById]);

  const officerSummaries = useMemo<OfficerSummary[]>(() => {
    return MOCK_USERS.map((user) => {
      const officerResults = sortResultsNewestFirst(
        qualificationResults.filter((result) => result.officerId === user.id),
        rangeDaysById,
      );

      const passedResults = officerResults.filter(isPassed);
      const failedResults = officerResults.filter(
        (result) => result.passed === false,
      );
      const dayResults = passedResults.filter((result) => result.runNumber === 1);
      const nightResults = passedResults.filter((result) => result.runNumber === 2);

      const lastDayQualification = dayResults[0];
      const lastNightQualification = nightResults[0];
      const lastQualification = passedResults[0];
      const lastQualificationDate = getResultDate(
        lastQualification,
        rangeDaysById,
      );
      const daysSinceLastQualification = getDaysSince(lastQualificationDate);
      const mostRecentResult = officerResults[0];

      let status: ReadinessStatus = "No Record";
      let statusReason = "No passing qualification record is recorded.";

      if (mostRecentResult?.passed === false) {
        status = "Failed";
        statusReason = "Most recent qualification result is marked failed.";
      } else if (passedResults.length === 0) {
        status = "No Record";
        statusReason = "No passing qualification record is recorded.";
      } else if (!lastDayQualification) {
        status = "Needs Day";
        statusReason = "No passing day qualification is recorded.";
      } else if (!lastNightQualification) {
        status = "Needs Night";
        statusReason = "Passing day qualification exists, but night qualification is missing.";
      } else if (
        typeof daysSinceLastQualification === "number" &&
        daysSinceLastQualification > QUALIFICATION_VALID_DAYS
      ) {
        status = "Overdue";
        statusReason = `${daysSinceLastQualification} days since the last passing qualification.`;
      } else {
        status = "Current";
        statusReason = "Passing day and night qualification records are present.";
      }

      return {
        officerId: user.id,
        officerName: user.name,
        status,
        statusReason,
        lastDayQualification,
        lastNightQualification,
        lastQualificationDate,
        failedQualificationCount: failedResults.length,
        scoreTrend: getScoreTrend(officerResults, rangeDaysById),
        trendDelta: getTrendDelta(officerResults, rangeDaysById),
      };
    });
  }, [qualificationResults, rangeDaysById]);

  const firearmAlerts = useMemo(() => {
    return MOCK_FIREARMS.map((firearm) => {
      const statusLabel = getFirearmStatusLabel(firearm);
      const normalizedStatus = statusLabel.toLowerCase();
      const malfunctions = workspace.malfunctions.filter(
        (malfunction) => malfunction.firearmId === firearm.id,
      );
      const unresolvedMalfunctions = malfunctions.filter(
        (malfunction) =>
          malfunction.inspectionRequired ||
          malfunction.removedFromService ||
          malfunction.resolvedOnRange === false,
      );

      const outOfService =
        normalizedStatus.includes("out") ||
        normalizedStatus.includes("maintenance") ||
        unresolvedMalfunctions.some(
          (malfunction) => malfunction.removedFromService,
        );

      return {
        firearmId: firearm.id,
        name: `${firearm.make} ${firearm.model}`,
        serialNumber: firearm.serialNumber,
        typeLabel: getFirearmTypeLabel(firearm),
        statusLabel,
        malfunctionCount: malfunctions.length,
        unresolvedCount: unresolvedMalfunctions.length,
        outOfService,
        requiresAttention: outOfService || unresolvedMalfunctions.length > 0,
      };
    }).filter((firearm) => firearm.requiresAttention);
  }, [workspace.malfunctions]);

  const drillAnalytics = useMemo<DrillAnalyticsSummary[]>(() => {
    const summaries = workspace.rangeDayDrills.map((drill) => {
      const drillResults = workspace.results.filter(
        (result) => result.drillId === drill.id,
      );
      const scoredResults = drillResults.filter(
        (result) => typeof result.score === "number",
      );
      const passableResults = drillResults.filter(
        (result) => typeof result.passed === "boolean",
      );
      const failedCount = passableResults.filter(
        (result) => result.passed === false,
      ).length;
      const passRate = passableResults.length
        ? Math.round(
            ((passableResults.length - failedCount) / passableResults.length) * 100,
          )
        : drillResults.length
          ? 100
          : 0;
      const averageScore = scoredResults.length
        ? Math.round(
            scoredResults.reduce(
              (total, result) => total + (result.score ?? 0),
              0,
            ) / scoredResults.length,
          )
        : undefined;

      return {
        drillId: drill.id,
        drillName: drill.name,
        resultCount: drillResults.length,
        passRate,
        averageScore,
        failedCount,
      };
    });

    return summaries
      .filter((summary) => summary.resultCount > 0)
      .sort((a, b) => a.passRate - b.passRate || b.failedCount - a.failedCount)
      .slice(0, 5);
  }, [workspace.rangeDayDrills, workspace.results]);

  const currentOfficerCount = officerSummaries.filter(
    (officer) => officer.status === "Current",
  ).length;
  const needsDayCount = officerSummaries.filter(
    (officer) => officer.status === "Needs Day" || officer.status === "No Record",
  ).length;
  const needsNightCount = officerSummaries.filter(
    (officer) => officer.status === "Needs Night",
  ).length;
  const failedOrOverdueCount = officerSummaries.filter(
    (officer) => officer.status === "Failed" || officer.status === "Overdue",
  ).length;
  const decliningOfficers = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Declining",
  );
  const improvingOfficerCount = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Improving",
  ).length;

  const scoredResults = workspace.results.filter(
    (result) => typeof result.score === "number",
  );
  const averageScore = scoredResults.length
    ? Math.round(
        scoredResults.reduce((total, result) => total + (result.score ?? 0), 0) /
          scoredResults.length,
      )
    : undefined;
  const completedRangeDays = activeRangeDays.filter(
    (rangeDay) =>
      rangeDay.status === "Completed" || rangeDay.status === "Locked",
  ).length;
  const readyPackets = activeRangeDays.filter(
    (rangeDay) => rangeDay.packetStatus === "Ready",
  ).length;
  const rosterAssignments = workspace.rangeRoster.length;
  const plannedDrills = workspace.rangeDayDrills.length;

  const criticalItems = useMemo<CriticalItem[]>(() => {
    const items: CriticalItem[] = [];

    for (const officer of officerSummaries) {
      if (officer.status === "Failed" || officer.status === "Overdue") {
        items.push({
          id: `critical-qual-${officer.officerId}`,
          title: `${officer.officerName} · ${officer.status}`,
          detail: officer.statusReason,
          module: "Qualifications",
          href: "/qualifications",
          priority: "Critical",
          icon: ShieldAlert,
        });
      }
    }

    for (const firearm of firearmAlerts) {
      items.push({
        id: `firearm-${firearm.firearmId}`,
        title: `${firearm.name} · ${firearm.serialNumber}`,
        detail: firearm.outOfService
          ? "Firearm is marked or inferred as out of service."
          : `${firearm.unresolvedCount} malfunction/inspection item${firearm.unresolvedCount === 1 ? "" : "s"} require review.`,
        module: "Firearms",
        href: "/firearms",
        priority: firearm.outOfService ? "Critical" : "High",
        icon: Wrench,
      });
    }

    for (const rangeDay of incompletePackets.slice(0, 6)) {
      items.push({
        id: `packet-${rangeDay.id}`,
        title: `Packet not ready · ${rangeDay.title}`,
        detail: `${formatDate(rangeDay.date)} · Packet status: ${rangeDay.packetStatus ?? "Needs Setup"}.`,
        module: "Range",
        href: "/range-days",
        priority: "Medium",
        icon: ClipboardList,
      });
    }

    for (const officer of officerSummaries) {
      if (officer.status === "Needs Day" || officer.status === "No Record") {
        items.push({
          id: `day-${officer.officerId}`,
          title: `${officer.officerName} · Day qualification gap`,
          detail: officer.statusReason,
          module: "Qualifications",
          href: "/qualifications",
          priority: "High",
          icon: Sun,
        });
      } else if (officer.status === "Needs Night") {
        items.push({
          id: `night-${officer.officerId}`,
          title: `${officer.officerName} · Night qualification gap`,
          detail: officer.statusReason,
          module: "Qualifications",
          href: "/qualifications",
          priority: "High",
          icon: Moon,
        });
      }
    }

    for (const officer of decliningOfficers) {
      items.push({
        id: `trend-${officer.officerId}`,
        title: `${officer.officerName} · Declining score trend`,
        detail: `Scores are trending down${typeof officer.trendDelta === "number" ? ` by ${Math.abs(officer.trendDelta)} points` : ""}.`,
        module: "Analytics",
        href: "/analytics",
        priority: "Medium",
        icon: TrendingDown,
      });
    }

    return items
      .sort((a, b) => getPriorityValue(a.priority) - getPriorityValue(b.priority))
      .slice(0, 8);
  }, [decliningOfficers, firearmAlerts, incompletePackets, officerSummaries]);

  const qualificationTone: Tone =
    failedOrOverdueCount > 0 || needsDayCount > 0
      ? "red"
      : needsNightCount > 0
        ? "amber"
        : "green";
  const rangeTone: Tone = incompletePackets.length > 0 ? "amber" : "green";
  const firearmTone: Tone = firearmAlerts.length > 0 ? "red" : "green";
  const trendTone: Tone = decliningOfficers.length > 0 ? "amber" : "blue";
  const recordTone: Tone = incompletePackets.length > 0 ? "amber" : "green";

  return (
    <TracePointShell activePage="Command Dashboard">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusPill
                  label={workspaceLoaded ? "Live Local Workspace" : "Loading"}
                  tone={workspaceLoaded ? "green" : "slate"}
                />
                <StatusPill label={DEMO_DEPARTMENT.name} tone="slate" />
                <StatusPill label="Command View" tone="blue" />
              </div>

              <h1 className="text-[24px] font-bold text-white">
                TracePoint Command Pulse
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] leading-5 text-slate-500">
                A command-level pulse check for firearms readiness, qualification
                gaps, range-day records, firearm reliability, and emerging training
                trends.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/range-days"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
              >
                <CalendarDays size={14} />
                Plan Range Day
              </Link>

              <Link
                href="/analytics"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <BarChart3 size={14} />
                View Analytics
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <PulseCard
            title="Qualification Readiness"
            value={`${currentOfficerCount}/${MOCK_USERS.length}`}
            label="Officers current"
            detail={`${needsDayCount} need day/no record · ${needsNightCount} need night · ${failedOrOverdueCount} failed/overdue.`}
            icon={Shield}
            tone={qualificationTone}
          />
          <PulseCard
            title="Range Readiness"
            value={upcomingRangeDays.length}
            label="Upcoming range days"
            detail={`${incompletePackets.length} active packet${incompletePackets.length === 1 ? "" : "s"} need setup or review.`}
            icon={CalendarDays}
            tone={rangeTone}
          />
          <PulseCard
            title="Firearm Reliability"
            value={firearmAlerts.length}
            label="Weapons flagged"
            detail={`${workspace.malfunctions.length} malfunction record${workspace.malfunctions.length === 1 ? "" : "s"} in the workspace.`}
            icon={Crosshair}
            tone={firearmTone}
          />
          <PulseCard
            title="Records Health"
            value={readyPackets}
            label="Packets ready"
            detail={`${completedRangeDays} completed/locked range day${completedRangeDays === 1 ? "" : "s"} · ${workspace.rangeDays.length} total saved.`}
            icon={FileText}
            tone={recordTone}
          />
          <PulseCard
            title="Performance Signal"
            value={averageScore ?? "—"}
            label="Average score"
            detail={`${decliningOfficers.length} declining · ${improvingOfficerCount} improving · ${drillAnalytics.length} drill signal${drillAnalytics.length === 1 ? "" : "s"}.`}
            icon={TrendingUp}
            tone={trendTone}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_430px]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-bold text-white">
                  <Activity size={18} className="text-blue-400" />
                  Critical Attention
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  The highest-priority qualification, firearm, range packet, and
                  performance items requiring command or training staff review.
                </p>
              </div>

              <StatusPill
                label={`${criticalItems.length} active item${criticalItems.length === 1 ? "" : "s"}`}
                tone={criticalItems.length > 0 ? "amber" : "green"}
              />
            </div>

            {criticalItems.length === 0 ? (
              <EmptyPanel message="No critical command attention items are currently identified from the saved workspace." />
            ) : (
              <div className="space-y-3">
                {criticalItems.map((item) => (
                  <CriticalItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">Module Snapshot</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Fast access to each TracePoint operating area without turning the
                dashboard into a full report.
              </p>

              <div className="mt-4 space-y-3">
                <SnapshotLink
                  title="Range & Training"
                  href="/range-days"
                  icon={CalendarDays}
                  primary={`${activeRangeDays.length} active range day${activeRangeDays.length === 1 ? "" : "s"}`}
                  secondary={`${rosterAssignments} roster assignments · ${plannedDrills} planned drills`}
                  tone={rangeTone}
                />
                <SnapshotLink
                  title="Qualifications"
                  href="/qualifications"
                  icon={Shield}
                  primary={`${currentOfficerCount} current · ${needsDayCount + needsNightCount + failedOrOverdueCount} gap${needsDayCount + needsNightCount + failedOrOverdueCount === 1 ? "" : "s"}`}
                  secondary={`${qualificationResults.length} qualification result${qualificationResults.length === 1 ? "" : "s"} saved`}
                  tone={qualificationTone}
                />
                <SnapshotLink
                  title="Firearms"
                  href="/firearms"
                  icon={Crosshair}
                  primary={`${firearmAlerts.length} firearm alert${firearmAlerts.length === 1 ? "" : "s"}`}
                  secondary={`${MOCK_FIREARMS.length} firearms loaded · ${workspace.malfunctions.length} malfunction records`}
                  tone={firearmTone}
                />
                <SnapshotLink
                  title="Analytics"
                  href="/analytics"
                  icon={BarChart3}
                  primary={`${decliningOfficers.length} declining · ${improvingOfficerCount} improving`}
                  secondary={`${drillAnalytics.length} drill/course signal${drillAnalytics.length === 1 ? "" : "s"}`}
                  tone={trendTone}
                />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">Qualification Snapshot</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Day and night are shown together so the readiness picture stays balanced.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                    <CheckCircle2 size={13} /> Current
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {currentOfficerCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-blue-300">
                    <Sun size={13} /> Need Day
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {needsDayCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                    <Moon size={13} /> Need Night
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {needsNightCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-red-300">
                    <AlertTriangle size={13} /> Failed/Overdue
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {failedOrOverdueCount}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-white">
                  Upcoming Range Days
                </h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  The next few scheduled events and their packet readiness.
                </p>
              </div>
              <StatusPill label={`${upcomingRangeDays.length} upcoming`} />
            </div>

            {upcomingRangeDays.length === 0 ? (
              <EmptyPanel message="No upcoming range days are currently saved." />
            ) : (
              <div className="space-y-3">
                {upcomingRangeDays.map((rangeDay) => {
                  const rosterCount = workspace.rangeRoster.filter(
                    (entry) => entry.rangeDayId === rangeDay.id,
                  ).length;
                  const drillCount = workspace.rangeDayDrills.filter(
                    (drill) => drill.rangeDayId === rangeDay.id,
                  ).length;

                  return (
                    <Link
                      key={rangeDay.id}
                      href="/range-days"
                      className="group block rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex flex-wrap gap-2">
                            <StatusPill label={rangeDay.status} />
                            <StatusPill
                              label={rangeDay.packetStatus ?? "Needs Setup"}
                              tone={
                                rangeDay.packetStatus === "Ready"
                                  ? "green"
                                  : "amber"
                              }
                            />
                          </div>
                          <p className="text-[14px] font-bold text-white">
                            {rangeDay.title}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatDate(rangeDay.date)} · {rangeDay.startTime ?? ""}
                            {rangeDay.endTime ? `-${rangeDay.endTime}` : ""} · {rangeDay.location}
                          </p>
                        </div>
                        <ChevronRight
                          size={16}
                          className="mt-1 text-slate-600 group-hover:text-blue-300"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                        <span>{rosterCount} officers</span>
                        <span>·</span>
                        <span>{drillCount} drills</span>
                        <span>·</span>
                        <span>Lead: {getUserName(rangeDay.leadInstructorId)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-white">
                  Analytics Watchlist
                </h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Trend signals and weaker drills from saved scores.
                </p>
              </div>
              <Link
                href="/analytics"
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                Open Analytics
              </Link>
            </div>

            {drillAnalytics.length === 0 && decliningOfficers.length === 0 ? (
              <EmptyPanel message="Enter more scored qualifications and drills to generate trend signals." />
            ) : (
              <div className="space-y-3">
                {decliningOfficers.slice(0, 3).map((officer) => (
                  <Link
                    key={`decline-${officer.officerId}`}
                    href="/analytics"
                    className="group flex items-start justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 transition hover:border-amber-500/40"
                  >
                    <div className="flex gap-3">
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-300">
                        <TrendingDown size={15} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white">
                          {officer.officerName} · Declining Trend
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Scores are trending down{typeof officer.trendDelta === "number" ? ` by ${Math.abs(officer.trendDelta)} points` : ""}.
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      size={15}
                      className="mt-1 text-slate-600 group-hover:text-amber-200"
                    />
                  </Link>
                ))}

                {drillAnalytics.slice(0, 4).map((drill) => (
                  <Link
                    key={drill.drillId}
                    href="/analytics"
                    className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
                  >
                    <div className="flex gap-3">
                      <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                        <Target size={15} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white">
                          {drill.drillName}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {drill.resultCount} result{drill.resultCount === 1 ? "" : "s"} · {drill.passRate}% pass rate
                          {typeof drill.averageScore === "number" ? ` · ${drill.averageScore} avg score` : ""}
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      size={15}
                      className="mt-1 text-slate-600 group-hover:text-blue-300"
                    />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
