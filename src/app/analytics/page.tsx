"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Filter,
  LineChart,
  Moon,
  Search,
  ShieldAlert,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
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

type TrendStatus = "Improving" | "Stable" | "Declining" | "Insufficient";

type AnalyticsFocus =
  | "All"
  | "Qualifications"
  | "Drills"
  | "Declining"
  | "Failures";

type PerformanceRecord = {
  id: string;
  rangeDayId: string;
  rangeDayTitle: string;
  rangeDayStatus: string;
  date: string;
  location: string;
  officerId: string;
  officerName: string;
  drillId: string;
  drillName: string;
  drillCategory: string;
  runNumber: number;
  runLabel: string;
  firearmId?: string;
  firearmName: string;
  score?: number;
  passed?: boolean;
  completed: boolean;
  instructorId?: string;
  instructorName: string;
  notes?: string;
  deficiencyObserved?: boolean;
  remedialTrainingRecommended?: boolean;
  malfunctionCount: number;
  isQualification: boolean;
  isRifle: boolean;
  scoringMode?: string;
  passingScore?: number;
  maxScore?: number;
};

type TrendSummary = {
  status: TrendStatus;
  diff?: number;
  earlyAverage?: number;
  recentAverage?: number;
  recordCount: number;
};

type OfficerAnalytics = {
  officerId: string;
  officerName: string;
  records: PerformanceRecord[];
  scoredRecords: PerformanceRecord[];
  qualificationRecords: PerformanceRecord[];
  drillRecords: PerformanceRecord[];
  averageScore?: number;
  qualificationAverage?: number;
  drillAverage?: number;
  dayQualificationAverage?: number;
  nightQualificationAverage?: number;
  dayNightGap?: number;
  passRate?: number;
  qualificationPassRate?: number;
  drillPassRate?: number;
  failedCount: number;
  deficiencyCount: number;
  remedialCount: number;
  malfunctionCount: number;
  trend: TrendSummary;
  latestRecord?: PerformanceRecord;
};

type DrillAnalytics = {
  key: string;
  drillName: string;
  drillCategory: string;
  records: PerformanceRecord[];
  scoredRecords: PerformanceRecord[];
  averageScore?: number;
  passRate?: number;
  failedCount: number;
  deficiencyCount: number;
  remedialCount: number;
  officerCount: number;
  rangeDayCount: number;
  trend: TrendSummary;
  isQualification: boolean;
  isRifle: boolean;
  recommendation: string;
};

type DepartmentAnalytics = {
  totalRecords: number;
  scoredRecords: number;
  averageScore?: number;
  qualificationAverage?: number;
  drillAverage?: number;
  dayQualificationAverage?: number;
  nightQualificationAverage?: number;
  dayNightGap?: number;
  passRate?: number;
  qualificationPassRate?: number;
  drillPassRate?: number;
  failedCount: number;
  deficiencyCount: number;
  remedialCount: number;
  malfunctionLinkedRuns: number;
  trend: TrendSummary;
};

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

const FOCUS_FILTERS: AnalyticsFocus[] = [
  "All",
  "Qualifications",
  "Drills",
  "Declining",
  "Failures",
];

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

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = date.includes("T")
    ? new Date(date).getTime()
    : new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function round(value?: number, digits = 1) {
  if (value === undefined || Number.isNaN(value)) return undefined;

  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function formatNumber(value?: number, suffix = "") {
  if (value === undefined || Number.isNaN(value)) return "—";

  return `${round(value)}${suffix}`;
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—";

  return `${Math.round(value)}%`;
}

function average(values: Array<number | undefined>) {
  const validValues = values.filter(
    (value): value is number => typeof value === "number" && !Number.isNaN(value),
  );

  if (!validValues.length) return undefined;

  return (
    validValues.reduce((total, value) => total + value, 0) / validValues.length
  );
}

function getPassRate(records: PerformanceRecord[]) {
  const passFailRecords = records.filter(
    (record) => typeof record.passed === "boolean",
  );

  if (!passFailRecords.length) return undefined;

  const passedRecords = passFailRecords.filter((record) => record.passed);

  return (passedRecords.length / passFailRecords.length) * 100;
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmName(firearmId?: string) {
  if (!firearmId) return "No firearm recorded";

  const firearm = MOCK_FIREARMS.find((item) => item.id === firearmId);

  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

function isQualificationText(value?: string) {
  return Boolean(value?.toLowerCase().includes("qualification"));
}

function isQualificationDrill(drill?: RangeDayDrill) {
  if (!drill) return false;

  return drill.category === "Qualification" || isQualificationText(drill.name);
}

function isRifleDrill(drill?: RangeDayDrill) {
  if (!drill) return false;

  const name = drill.name.toLowerCase();
  const category = drill.category.toLowerCase();
  const firearmType = drill.firearmType?.toLowerCase() ?? "";

  return (
    name.includes("rifle") ||
    category.includes("rifle") ||
    firearmType.includes("rifle")
  );
}

function getRunLabel(drill?: RangeDayDrill, runNumber?: number) {
  if (isQualificationDrill(drill)) {
    if (runNumber === 1) return "Day Qualification";
    if (runNumber === 2) return "Night Qualification";
  }

  return `Run ${runNumber ?? 1}`;
}

function derivePassedStatus(result: DrillRunResult, drill?: RangeDayDrill) {
  if (typeof result.passed === "boolean") return result.passed;

  if (
    typeof result.score === "number" &&
    typeof drill?.passingScore === "number"
  ) {
    return result.score >= drill.passingScore;
  }

  return undefined;
}

function buildPerformanceRecords(
  workspace: StoredRangeDayWorkspace,
): PerformanceRecord[] {
  const rangeDayById = new Map(
    workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
  );

  const drillById = new Map(
    workspace.rangeDayDrills.map((drill) => [drill.id, drill]),
  );

  return workspace.results
    .map<PerformanceRecord | null>((result) => {
      const rangeDay = rangeDayById.get(result.rangeDayId);
      const drill = drillById.get(result.drillId);

      if (!rangeDay && !drill) return null;

      const malfunctionCount = workspace.malfunctions.filter(
        (malfunction) =>
          malfunction.drillRunId === result.id ||
          result.malfunctionIds?.includes(malfunction.id),
      ).length;

      const score =
        typeof result.score === "number" && !Number.isNaN(result.score)
          ? result.score
          : undefined;

      return {
        id: result.id,
        rangeDayId: result.rangeDayId,
        rangeDayTitle: rangeDay?.title ?? "Unknown Range Day",
        rangeDayStatus: rangeDay?.status ?? "Unknown",
        date: rangeDay?.date ?? "",
        location: rangeDay?.location ?? "No location recorded",
        officerId: result.officerId,
        officerName: getUserName(result.officerId),
        drillId: result.drillId,
        drillName: drill?.name ?? "Unknown Drill",
        drillCategory: drill?.category ?? "Unknown",
        runNumber: result.runNumber,
        runLabel: getRunLabel(drill, result.runNumber),
        firearmId: result.firearmId,
        firearmName: getFirearmName(result.firearmId),
        score,
        passed: derivePassedStatus(result, drill),
        completed: result.completed,
        instructorId: result.instructorId,
        instructorName: getUserName(result.instructorId),
        notes: result.notes,
        deficiencyObserved: result.deficiencyObserved,
        remedialTrainingRecommended: result.remedialTrainingRecommended,
        malfunctionCount,
        isQualification: isQualificationDrill(drill),
        isRifle: isRifleDrill(drill),
        scoringMode: drill?.scoringMode,
        passingScore: drill?.passingScore,
        maxScore: drill?.maxScore,
      };
    })
    .filter((record): record is PerformanceRecord => Boolean(record))
    .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));
}

function calculateTrend(records: PerformanceRecord[]): TrendSummary {
  const scoredRecords = records
    .filter((record) => typeof record.score === "number")
    .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));

  if (scoredRecords.length < 3) {
    return {
      status: "Insufficient",
      recordCount: scoredRecords.length,
    };
  }

  const midpoint = Math.max(Math.floor(scoredRecords.length / 2), 1);
  const earlyRecords = scoredRecords.slice(0, midpoint);
  const recentRecords = scoredRecords.slice(midpoint);

  const earlyAverage = average(earlyRecords.map((record) => record.score));
  const recentAverage = average(recentRecords.map((record) => record.score));

  if (earlyAverage === undefined || recentAverage === undefined) {
    return {
      status: "Insufficient",
      recordCount: scoredRecords.length,
    };
  }

  const diff = recentAverage - earlyAverage;

  if (diff >= 3) {
    return {
      status: "Improving",
      diff,
      earlyAverage,
      recentAverage,
      recordCount: scoredRecords.length,
    };
  }

  if (diff <= -3) {
    return {
      status: "Declining",
      diff,
      earlyAverage,
      recentAverage,
      recordCount: scoredRecords.length,
    };
  }

  return {
    status: "Stable",
    diff,
    earlyAverage,
    recentAverage,
    recordCount: scoredRecords.length,
  };
}

function buildOfficerAnalytics(records: PerformanceRecord[]): OfficerAnalytics[] {
  const recordsByOfficer = new Map<string, PerformanceRecord[]>();

  records.forEach((record) => {
    const current = recordsByOfficer.get(record.officerId) ?? [];
    current.push(record);
    recordsByOfficer.set(record.officerId, current);
  });

  return MOCK_USERS.map<OfficerAnalytics>((officer) => {
    const officerRecords = (recordsByOfficer.get(officer.id) ?? []).sort(
      (a, b) => getDateValue(a.date) - getDateValue(b.date),
    );

    const scoredRecords = officerRecords.filter(
      (record) => typeof record.score === "number",
    );
    const qualificationRecords = officerRecords.filter(
      (record) => record.isQualification,
    );
    const drillRecords = officerRecords.filter(
      (record) => !record.isQualification,
    );
    const dayQualificationRecords = qualificationRecords.filter(
      (record) => record.runNumber === 1,
    );
    const nightQualificationRecords = qualificationRecords.filter(
      (record) => record.runNumber === 2,
    );
    const failedRecords = officerRecords.filter(
      (record) => record.passed === false,
    );

    const dayQualificationAverage = average(
      dayQualificationRecords.map((record) => record.score),
    );
    const nightQualificationAverage = average(
      nightQualificationRecords.map((record) => record.score),
    );

    const latestRecord = [...officerRecords].sort(
      (a, b) => getDateValue(b.date) - getDateValue(a.date),
    )[0];

    return {
      officerId: officer.id,
      officerName: officer.name,
      records: officerRecords,
      scoredRecords,
      qualificationRecords,
      drillRecords,
      averageScore: average(scoredRecords.map((record) => record.score)),
      qualificationAverage: average(
        qualificationRecords.map((record) => record.score),
      ),
      drillAverage: average(drillRecords.map((record) => record.score)),
      dayQualificationAverage,
      nightQualificationAverage,
      dayNightGap:
        dayQualificationAverage !== undefined &&
        nightQualificationAverage !== undefined
          ? dayQualificationAverage - nightQualificationAverage
          : undefined,
      passRate: getPassRate(officerRecords),
      qualificationPassRate: getPassRate(qualificationRecords),
      drillPassRate: getPassRate(drillRecords),
      failedCount: failedRecords.length,
      deficiencyCount: officerRecords.filter((record) => record.deficiencyObserved)
        .length,
      remedialCount: officerRecords.filter(
        (record) => record.remedialTrainingRecommended,
      ).length,
      malfunctionCount: officerRecords.reduce(
        (total, record) => total + record.malfunctionCount,
        0,
      ),
      trend: calculateTrend(scoredRecords),
      latestRecord,
    };
  }).sort((a, b) => a.officerName.localeCompare(b.officerName));
}

function getDrillRecommendation(analytics: Omit<DrillAnalytics, "recommendation">) {
  if (analytics.records.length === 0) return "No recorded runs yet.";

  if (analytics.failedCount >= 2 || (analytics.passRate ?? 100) < 80) {
    return "Review course design, instructor notes, and consider remedial training block.";
  }

  if (analytics.trend.status === "Declining") {
    return "Performance is trending down. Monitor next range day and compare conditions.";
  }

  if (
    analytics.averageScore !== undefined &&
    analytics.averageScore < 80 &&
    analytics.isQualification
  ) {
    return "Qualification average is close to or below typical passing range.";
  }

  if (analytics.deficiencyCount > 0 || analytics.remedialCount > 0) {
    return "Instructor notes show deficiencies. Review related officer histories.";
  }

  if (analytics.trend.status === "Improving") {
    return "Performance is improving. Current training approach appears effective.";
  }

  return "No immediate trend concern detected.";
}

function buildDrillAnalytics(records: PerformanceRecord[]): DrillAnalytics[] {
  const recordsByDrill = new Map<string, PerformanceRecord[]>();

  records.forEach((record) => {
    const key = `${record.drillName}::${record.drillCategory}`;
    const current = recordsByDrill.get(key) ?? [];
    current.push(record);
    recordsByDrill.set(key, current);
  });

  return Array.from(recordsByDrill.entries())
    .map<DrillAnalytics>(([key, drillRecords]) => {
      const sortedRecords = [...drillRecords].sort(
        (a, b) => getDateValue(a.date) - getDateValue(b.date),
      );
      const scoredRecords = sortedRecords.filter(
        (record) => typeof record.score === "number",
      );
      const baseAnalytics = {
        key,
        drillName: sortedRecords[0]?.drillName ?? "Unknown Drill",
        drillCategory: sortedRecords[0]?.drillCategory ?? "Unknown",
        records: sortedRecords,
        scoredRecords,
        averageScore: average(scoredRecords.map((record) => record.score)),
        passRate: getPassRate(sortedRecords),
        failedCount: sortedRecords.filter((record) => record.passed === false)
          .length,
        deficiencyCount: sortedRecords.filter((record) => record.deficiencyObserved)
          .length,
        remedialCount: sortedRecords.filter(
          (record) => record.remedialTrainingRecommended,
        ).length,
        officerCount: new Set(sortedRecords.map((record) => record.officerId)).size,
        rangeDayCount: new Set(sortedRecords.map((record) => record.rangeDayId))
          .size,
        trend: calculateTrend(scoredRecords),
        isQualification: sortedRecords.some((record) => record.isQualification),
        isRifle: sortedRecords.some((record) => record.isRifle),
      };

      return {
        ...baseAnalytics,
        recommendation: getDrillRecommendation(baseAnalytics),
      };
    })
    .sort((a, b) => {
      const aPass = a.passRate ?? 101;
      const bPass = b.passRate ?? 101;

      if (aPass !== bPass) return aPass - bPass;

      return b.failedCount - a.failedCount;
    });
}

function buildDepartmentAnalytics(records: PerformanceRecord[]): DepartmentAnalytics {
  const scoredRecords = records.filter((record) => typeof record.score === "number");
  const qualificationRecords = records.filter((record) => record.isQualification);
  const drillRecords = records.filter((record) => !record.isQualification);
  const dayQualificationRecords = qualificationRecords.filter(
    (record) => record.runNumber === 1,
  );
  const nightQualificationRecords = qualificationRecords.filter(
    (record) => record.runNumber === 2,
  );

  const dayQualificationAverage = average(
    dayQualificationRecords.map((record) => record.score),
  );
  const nightQualificationAverage = average(
    nightQualificationRecords.map((record) => record.score),
  );

  return {
    totalRecords: records.length,
    scoredRecords: scoredRecords.length,
    averageScore: average(scoredRecords.map((record) => record.score)),
    qualificationAverage: average(
      qualificationRecords.map((record) => record.score),
    ),
    drillAverage: average(drillRecords.map((record) => record.score)),
    dayQualificationAverage,
    nightQualificationAverage,
    dayNightGap:
      dayQualificationAverage !== undefined && nightQualificationAverage !== undefined
        ? dayQualificationAverage - nightQualificationAverage
        : undefined,
    passRate: getPassRate(records),
    qualificationPassRate: getPassRate(qualificationRecords),
    drillPassRate: getPassRate(drillRecords),
    failedCount: records.filter((record) => record.passed === false).length,
    deficiencyCount: records.filter((record) => record.deficiencyObserved).length,
    remedialCount: records.filter((record) => record.remedialTrainingRecommended)
      .length,
    malfunctionLinkedRuns: records.filter((record) => record.malfunctionCount > 0)
      .length,
    trend: calculateTrend(scoredRecords),
  };
}

function getTrendTone(status: TrendStatus) {
  if (status === "Improving") return "green";
  if (status === "Declining") return "red";
  if (status === "Stable") return "blue";

  return "slate";
}

function StatusPill({
  label,
  tone = "blue",
}: {
  label: string;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const styles = {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function TrendPill({ trend }: { trend: TrendSummary }) {
  const tone = getTrendTone(trend.status);
  const Icon =
    trend.status === "Improving"
      ? TrendingUp
      : trend.status === "Declining"
        ? TrendingDown
        : LineChart;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
        tone === "green"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : tone === "red"
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : tone === "blue"
              ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
              : "border-slate-700 bg-slate-800/60 text-slate-300"
      }`}
    >
      <Icon size={11} />
      {trend.status}
      {trend.diff !== undefined && trend.status !== "Insufficient" && (
        <span>{trend.diff > 0 ? "+" : ""}{round(trend.diff)}</span>
      )}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
        </div>
        <Icon size={17} className="text-blue-400" />
      </div>
    </div>
  );
}

function ProgressBar({ value }: { value?: number }) {
  const safeValue = Math.max(0, Math.min(value ?? 0, 100));

  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-blue-500"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="flex h-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 text-[10px] text-slate-600">
        Need more data
      </div>
    );
  }

  const width = 160;
  const height = 42;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / spread) * height;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-10 w-full text-blue-400"
      preserveAspectRatio="none"
      role="img"
      aria-label="Score trend sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InsightCard({
  title,
  children,
  tone = "blue",
  icon: Icon,
}: {
  title: string;
  children: ReactNode;
  tone?: "blue" | "green" | "amber" | "red";
  icon: ComponentType<{ size?: number; className?: string }>;
}) {
  const iconStyle =
    tone === "green"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : tone === "red"
          ? "text-red-300"
          : "text-blue-300";

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className={iconStyle} />
        <h3 className="text-[14px] font-bold text-white">{title}</h3>
      </div>
      <div className="text-[12px] leading-5 text-slate-400">{children}</div>
    </div>
  );
}

function matchesSearch(value: string, searchTerm: string) {
  if (!searchTerm.trim()) return true;

  return value.toLowerCase().includes(searchTerm.trim().toLowerCase());
}

function applyFocusToOfficer(analytics: OfficerAnalytics, focus: AnalyticsFocus) {
  if (focus === "All") return true;
  if (focus === "Qualifications") return analytics.qualificationRecords.length > 0;
  if (focus === "Drills") return analytics.drillRecords.length > 0;
  if (focus === "Declining") return analytics.trend.status === "Declining";
  if (focus === "Failures") return analytics.failedCount > 0;

  return true;
}

function applyFocusToDrill(analytics: DrillAnalytics, focus: AnalyticsFocus) {
  if (focus === "All") return true;
  if (focus === "Qualifications") return analytics.isQualification;
  if (focus === "Drills") return !analytics.isQualification;
  if (focus === "Declining") return analytics.trend.status === "Declining";
  if (focus === "Failures") return analytics.failedCount > 0;

  return true;
}

function OfficerAnalyticsCard({ analytics }: { analytics: OfficerAnalytics }) {
  const sparklineValues = analytics.scoredRecords
    .map((record) => record.score)
    .filter((score): score is number => typeof score === "number");

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <TrendPill trend={analytics.trend} />
            {analytics.failedCount > 0 && (
              <StatusPill label={`${analytics.failedCount} fail`} tone="red" />
            )}
            {analytics.deficiencyCount > 0 && (
              <StatusPill label="Deficiency" tone="amber" />
            )}
          </div>

          <h3 className="text-[15px] font-bold text-white">
            {analytics.officerName}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {analytics.records.length} total record
            {analytics.records.length !== 1 ? "s" : ""} · latest: {" "}
            {analytics.latestRecord
              ? `${analytics.latestRecord.drillName} on ${formatDate(
                  analytics.latestRecord.date,
                )}`
              : "none"}
          </p>
        </div>

        <User size={18} className="text-slate-600" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Avg Score
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatNumber(analytics.averageScore)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Qual Avg
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatNumber(analytics.qualificationAverage)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Drill Avg
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatNumber(analytics.drillAverage)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Pass Rate
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatPercent(analytics.passRate)}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Score Trend
          </p>
          <p className="text-[10px] text-slate-500">
            {analytics.scoredRecords.length} scored record
            {analytics.scoredRecords.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Sparkline values={sparklineValues} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
            Day / Night Gap
          </p>
          <p className="text-[12px] text-slate-400">
            Day {formatNumber(analytics.dayQualificationAverage)} · Night {" "}
            {formatNumber(analytics.nightQualificationAverage)} · Gap {" "}
            {formatNumber(analytics.dayNightGap)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
            Risk Signals
          </p>
          <p className="text-[12px] text-slate-400">
            {analytics.failedCount} fail · {analytics.deficiencyCount} deficiency · {" "}
            {analytics.remedialCount} remedial · {analytics.malfunctionCount} malfunction link
          </p>
        </div>
      </div>
    </div>
  );
}

function DrillAnalyticsRow({ analytics }: { analytics: DrillAnalytics }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="grid gap-3 lg:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr_1fr] lg:items-center">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill label={analytics.drillCategory} tone="slate" />
            {analytics.isQualification && <StatusPill label="Qualification" />}
            {analytics.isRifle && <StatusPill label="Rifle" tone="slate" />}
            <TrendPill trend={analytics.trend} />
          </div>
          <h3 className="text-[13px] font-bold text-white">
            {analytics.drillName}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {analytics.records.length} run{analytics.records.length !== 1 ? "s" : ""} · {" "}
            {analytics.officerCount} officer{analytics.officerCount !== 1 ? "s" : ""} · {" "}
            {analytics.rangeDayCount} range day{analytics.rangeDayCount !== 1 ? "s" : ""}
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Avg Score
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatNumber(analytics.averageScore)}
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Pass Rate
          </p>
          <p className="mt-1 text-[15px] font-bold text-white">
            {formatPercent(analytics.passRate)}
          </p>
          <div className="mt-2">
            <ProgressBar value={analytics.passRate} />
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Flags
          </p>
          <p className="mt-1 text-[12px] text-slate-400">
            {analytics.failedCount} fail · {analytics.deficiencyCount} def. · {" "}
            {analytics.remedialCount} remedial
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Recommendation
          </p>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            {analytics.recommendation}
          </p>
        </div>
      </div>
    </div>
  );
}

function RecentRecordRow({ record }: { record: PerformanceRecord }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill
              label={record.isQualification ? record.runLabel : record.drillCategory}
              tone={record.isQualification ? "blue" : "slate"}
            />
            {record.passed === false && <StatusPill label="Failed" tone="red" />}
            {record.deficiencyObserved && (
              <StatusPill label="Deficiency" tone="amber" />
            )}
            {record.malfunctionCount > 0 && (
              <StatusPill label="Malfunction" tone="amber" />
            )}
          </div>
          <h3 className="text-[13px] font-bold text-white">
            {record.officerName} · {record.drillName}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {record.rangeDayTitle} · {formatDate(record.date)} · {record.location}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Firearm: {record.firearmName} · Instructor: {record.instructorName}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-right md:min-w-[240px]">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600">
              Score
            </p>
            <p className="mt-1 text-[14px] font-bold text-white">
              {formatNumber(record.score)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600">
              Result
            </p>
            <p className="mt-1 text-[14px] font-bold text-white">
              {record.passed === true
                ? "Pass"
                : record.passed === false
                  ? "Fail"
                  : record.completed
                    ? "Done"
                    : "Open"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600">
              Run
            </p>
            <p className="mt-1 text-[14px] font-bold text-white">
              {record.runNumber}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [workspace, setWorkspace] = useState<StoredRangeDayWorkspace>(
    EMPTY_WORKSPACE,
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [focusFilter, setFocusFilter] = useState<AnalyticsFocus>("All");

  useEffect(() => {
    setWorkspace(loadStoredRangeDayWorkspace() ?? EMPTY_WORKSPACE);
  }, []);

  const performanceRecords = useMemo(
    () => buildPerformanceRecords(workspace),
    [workspace],
  );

  const departmentAnalytics = useMemo(
    () => buildDepartmentAnalytics(performanceRecords),
    [performanceRecords],
  );

  const officerAnalytics = useMemo(
    () => buildOfficerAnalytics(performanceRecords),
    [performanceRecords],
  );

  const drillAnalytics = useMemo(
    () => buildDrillAnalytics(performanceRecords),
    [performanceRecords],
  );

  const filteredOfficerAnalytics = useMemo(() => {
    return officerAnalytics.filter((analytics) => {
      const searchable = [
        analytics.officerName,
        analytics.latestRecord?.drillName,
        analytics.latestRecord?.rangeDayTitle,
        analytics.latestRecord?.firearmName,
        analytics.trend.status,
      ]
        .filter(Boolean)
        .join(" ");

      return (
        matchesSearch(searchable, searchTerm) &&
        applyFocusToOfficer(analytics, focusFilter)
      );
    });
  }, [focusFilter, officerAnalytics, searchTerm]);

  const filteredDrillAnalytics = useMemo(() => {
    return drillAnalytics.filter((analytics) => {
      const searchable = [
        analytics.drillName,
        analytics.drillCategory,
        analytics.trend.status,
        analytics.recommendation,
      ].join(" ");

      return (
        matchesSearch(searchable, searchTerm) &&
        applyFocusToDrill(analytics, focusFilter)
      );
    });
  }, [drillAnalytics, focusFilter, searchTerm]);

  const recentRecords = useMemo(() => {
    return [...performanceRecords]
      .sort((a, b) => getDateValue(b.date) - getDateValue(a.date))
      .slice(0, 10);
  }, [performanceRecords]);

  const decliningOfficers = officerAnalytics
    .filter((analytics) => analytics.trend.status === "Declining")
    .sort((a, b) => (a.trend.diff ?? 0) - (b.trend.diff ?? 0))
    .slice(0, 3);

  const improvingOfficers = officerAnalytics
    .filter((analytics) => analytics.trend.status === "Improving")
    .sort((a, b) => (b.trend.diff ?? 0) - (a.trend.diff ?? 0))
    .slice(0, 3);

  const weakDrills = drillAnalytics
    .filter(
      (analytics) =>
        analytics.failedCount > 0 ||
        analytics.trend.status === "Declining" ||
        (analytics.passRate !== undefined && analytics.passRate < 85),
    )
    .slice(0, 4);

  const repeatedFailures = officerAnalytics
    .filter((analytics) => analytics.failedCount >= 2)
    .sort((a, b) => b.failedCount - a.failedCount)
    .slice(0, 3);

  const clearFilters = () => {
    setSearchTerm("");
    setFocusFilter("All");
  };

  return (
    <TracePointShell activePage="Analytics">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <BarChart3 size={18} className="text-blue-400" />
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Performance Analytics
                </p>
              </div>
              <h1 className="text-[22px] font-bold text-white">
                Qualification &amp; Drill Trends
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] text-slate-500">
                Track qualification scores, drill performance, pass rates, day/night
                gaps, declining officers, repeated failures, and weak training areas
                from saved range-day data.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/range-days"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <CalendarDays size={14} />
                Range Days
              </Link>
              <Link
                href="/qualifications"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <Target size={14} />
                Qualifications
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          <StatCard
            label="Records"
            value={departmentAnalytics.totalRecords}
            sub={`${departmentAnalytics.scoredRecords} scored`}
            icon={BarChart3}
          />
          <StatCard
            label="Avg Score"
            value={formatNumber(departmentAnalytics.averageScore)}
            sub="All scored runs"
            icon={LineChart}
          />
          <StatCard
            label="Qual Avg"
            value={formatNumber(departmentAnalytics.qualificationAverage)}
            sub="Qualification scores"
            icon={Target}
          />
          <StatCard
            label="Drill Avg"
            value={formatNumber(departmentAnalytics.drillAverage)}
            sub="Non-qual drills"
            icon={Crosshair}
          />
          <StatCard
            label="Pass Rate"
            value={formatPercent(departmentAnalytics.passRate)}
            sub={`${departmentAnalytics.failedCount} failed runs`}
            icon={CheckCircle2}
          />
          <StatCard
            label="Trend"
            value={departmentAnalytics.trend.status}
            sub={
              departmentAnalytics.trend.diff !== undefined
                ? `${departmentAnalytics.trend.diff > 0 ? "+" : ""}${formatNumber(
                    departmentAnalytics.trend.diff,
                  )} recent shift`
                : "Need more data"
            }
            icon={TrendingUp}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <InsightCard title="Day vs. Night Gap" icon={Moon} tone="blue">
            <p>
              Day average: <span className="font-semibold text-white">{formatNumber(departmentAnalytics.dayQualificationAverage)}</span>
              . Night average: <span className="font-semibold text-white">{formatNumber(departmentAnalytics.nightQualificationAverage)}</span>
              . Gap: <span className="font-semibold text-white">{formatNumber(departmentAnalytics.dayNightGap)}</span>.
            </p>
            {departmentAnalytics.dayNightGap !== undefined &&
              Math.abs(departmentAnalytics.dayNightGap) >= 5 && (
                <p className="mt-2 text-amber-300">
                  Significant day/night difference detected. Review low-light or night-fire performance.
                </p>
              )}
          </InsightCard>

          <InsightCard title="Declining Officers" icon={TrendingDown} tone="red">
            {decliningOfficers.length ? (
              <ul className="space-y-1">
                {decliningOfficers.map((officer) => (
                  <li key={officer.officerId}>
                    <span className="font-semibold text-white">{officer.officerName}</span> · {" "}
                    {formatNumber(officer.trend.diff)} point shift
                  </li>
                ))}
              </ul>
            ) : (
              <p>No officer decline trend detected yet.</p>
            )}
          </InsightCard>

          <InsightCard title="Weak Drills" icon={ShieldAlert} tone="amber">
            {weakDrills.length ? (
              <ul className="space-y-1">
                {weakDrills.map((drill) => (
                  <li key={drill.key}>
                    <span className="font-semibold text-white">{drill.drillName}</span> · {" "}
                    {formatPercent(drill.passRate)} pass · {drill.failedCount} fail
                  </li>
                ))}
              </ul>
            ) : (
              <p>No weak drill pattern detected yet.</p>
            )}
          </InsightCard>

          <InsightCard title="Improving Officers" icon={TrendingUp} tone="green">
            {improvingOfficers.length ? (
              <ul className="space-y-1">
                {improvingOfficers.map((officer) => (
                  <li key={officer.officerId}>
                    <span className="font-semibold text-white">{officer.officerName}</span> · +{formatNumber(officer.trend.diff)} point shift
                  </li>
                ))}
              </ul>
            ) : (
              <p>No improvement trend detected yet.</p>
            )}
          </InsightCard>
        </section>

        {repeatedFailures.length > 0 && (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-red-300" />
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  Repeated Failure Pattern
                </h2>
                <p className="mt-1 text-[12px] text-red-100/80">
                  {repeatedFailures.map((officer) => officer.officerName).join(", ")} {" "}
                  {repeatedFailures.length === 1 ? "has" : "have"} two or more failed recorded runs. Review range notes and remedial training recommendations.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-center">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
              />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search officer, drill, range day, firearm, trend, recommendation..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-[13px] text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="relative">
              <Filter
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
              />
              <select
                value={focusFilter}
                onChange={(event) =>
                  setFocusFilter(event.target.value as AnalyticsFocus)
                }
                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-[13px] text-white outline-none focus:border-blue-500"
              >
                {FOCUS_FILTERS.map((filter) => (
                  <option key={filter} value={filter}>
                    {filter}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
            >
              <X size={14} />
              Clear Filters
            </button>
          </div>
        </section>

        {performanceRecords.length === 0 && (
          <section className="rounded-3xl border border-blue-500/20 bg-blue-500/[0.06] p-5">
            <div className="flex items-start gap-3">
              <BarChart3 size={18} className="mt-0.5 text-blue-300" />
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  No analytics data yet
                </h2>
                <p className="mt-1 text-[12px] text-slate-400">
                  Create a range day, add officers, enter day/night qualification
                  scores or drill scores, and click Save Range Day. This page will
                  then calculate trend analytics from those saved records.
                </p>
                <Link
                  href="/range-days"
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-blue-500"
                >
                  Go to Range Days
                  <ChevronRight size={14} />
                </Link>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Officer Performance Trends
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Officer-level averages, pass rates, day/night gap, and score movement.
                  </p>
                </div>
                <Users size={18} className="text-blue-400" />
              </div>

              <div className="grid gap-3 2xl:grid-cols-2">
                {filteredOfficerAnalytics.map((analytics) => (
                  <OfficerAnalyticsCard
                    key={analytics.officerId}
                    analytics={analytics}
                  />
                ))}
              </div>

              {filteredOfficerAnalytics.length === 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-center text-[13px] text-slate-500">
                  No officer analytics match the current filters.
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Drill &amp; Course Analysis
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Drill-level pass rates, score averages, deficiencies, remedial flags, and trend recommendations.
                  </p>
                </div>
                <Crosshair size={18} className="text-blue-400" />
              </div>

              <div className="space-y-3">
                {filteredDrillAnalytics.map((analytics) => (
                  <DrillAnalyticsRow key={analytics.key} analytics={analytics} />
                ))}
              </div>

              {filteredDrillAnalytics.length === 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-center text-[13px] text-slate-500">
                  No drill analytics match the current filters.
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-white">
                <Sun size={16} className="text-blue-400" />
                Qualification Split
              </h2>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-slate-400">Day Qualification Avg</span>
                    <span className="font-semibold text-white">
                      {formatNumber(departmentAnalytics.dayQualificationAverage)}
                    </span>
                  </div>
                  <ProgressBar value={departmentAnalytics.dayQualificationAverage} />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-slate-400">Night Qualification Avg</span>
                    <span className="font-semibold text-white">
                      {formatNumber(departmentAnalytics.nightQualificationAverage)}
                    </span>
                  </div>
                  <ProgressBar value={departmentAnalytics.nightQualificationAverage} />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-slate-400">Qualification Pass Rate</span>
                    <span className="font-semibold text-white">
                      {formatPercent(departmentAnalytics.qualificationPassRate)}
                    </span>
                  </div>
                  <ProgressBar value={departmentAnalytics.qualificationPassRate} />
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-[12px] text-slate-400">
                  <p>
                    Gap interpretation: a positive gap means day scores are higher than night scores. A negative gap means night scores are higher.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-white">
                <AlertTriangle size={16} className="text-amber-300" />
                Training Risk Signals
              </h2>

              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-600">
                    Failed Runs
                  </p>
                  <p className="mt-1 text-xl font-bold text-white">
                    {departmentAnalytics.failedCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Pass/fail records marked failed.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-600">
                    Deficiencies
                  </p>
                  <p className="mt-1 text-xl font-bold text-white">
                    {departmentAnalytics.deficiencyCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Instructor-flagged deficiencies.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-600">
                    Remedial Recommended
                  </p>
                  <p className="mt-1 text-xl font-bold text-white">
                    {departmentAnalytics.remedialCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Runs where remedial training was recommended.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-600">
                    Malfunction-Linked Runs
                  </p>
                  <p className="mt-1 text-xl font-bold text-white">
                    {departmentAnalytics.malfunctionLinkedRuns}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Performance records tied to a firearm malfunction.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-white">
                <CalendarDays size={16} className="text-blue-400" />
                Recent Records
              </h2>

              <div className="space-y-3">
                {recentRecords.map((record) => (
                  <RecentRecordRow key={record.id} record={record} />
                ))}
              </div>

              {recentRecords.length === 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center text-[12px] text-slate-500">
                  No recent records yet.
                </div>
              )}
            </section>
          </aside>
        </section>
      </div>
    </TracePointShell>
  );
}
